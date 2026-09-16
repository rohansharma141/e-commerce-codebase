import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import {
  MigrationRunner,
  currentTenantBinding,
  tenantDrizzleAccessor,
  withTenantConnection,
} from '@platform/shared/database';
import { runWithTenant } from '@platform/shared/tenant-context';
import { ChannelReadModel } from '@platform/modules/channels/contracts';
import { ChannelReconciler } from './channel-reconciler';
import { ChannelsRepository } from './channels.repository';

/**
 * Reconciliation closes the stale-hit gap (C-15).
 *
 * The backlog's check, restated: drop a `channels.archived` event and the
 * consumer keeps resolving the archived channel — the write succeeds forever
 * and no existing test notices. Reconciliation is what eventually makes it
 * reject. And the reload must assert a **non-zero** row count, so an
 * RLS-blinded reconciler fails rather than passing vacuously.
 *
 * ── What each prints if the thing under test did nothing ──────────────────
 *
 *   - "a dropped archive leaves a stale hit"     — this one PASSES against the
 *                                                  bug on purpose: it is the
 *                                                  demonstration of the gap,
 *                                                  not the fix
 *   - "reconciliation removes it"                — the archived channel is still
 *                                                  resolvable after reload
 *   - "reads a non-zero count"                   — 0, and the test would have
 *                                                  passed on `0 = 0` without it
 *   - "without system_worker it sees nothing"    — rows come back, meaning the
 *                                                  RLS clause is not what is
 *                                                  making the reload work and
 *                                                  something else has opened
 *                                                  the table
 *   - "a zero-row read does not wipe the replica" — the replica is empty after
 *                                                  a blinded reload, turning a
 *                                                  fault into a read-through
 *                                                  storm that masks it
 *
 * Does NOT drop the schema, unlike channels.integration.spec.ts — jest runs
 * files in parallel and two suites dropping the same schema race each other.
 * A unique tenant id per run keeps this isolated instead.
 */

const TEST_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_URL ? describe : describe.skip;

jest.setTimeout(60_000);

describeIfDb('channel reconciliation', () => {
  let sql: Sql;
  let repo: ChannelsRepository;
  const t = `recon-${randomUUID().slice(0, 8)}`;

  const asT = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithTenant({ tenantId: t, requestId: randomUUID() }, () =>
      withTenantConnection(sql, t, fn),
    );

  beforeAll(async () => {
    sql = postgres(TEST_URL as string, { max: 6 });
    // Idempotent via the ledger; does not drop anything.
    await new MigrationRunner(sql).apply(join(__dirname, 'db', 'migrations'), 'channels');
    repo = new ChannelsRepository(tenantDrizzleAccessor);
    await asT(async () => {
      await repo.upsertTenantDefaults(t, {
        currencyCode: 'GBP',
        defaultLocale: 'en-GB',
        supportedLocales: ['en-GB'],
        country: 'GB',
        timezone: 'Europe/London',
        taxDisplay: 'net',
        taxRateBps: 2000,
      });
      const uk = await repo.create(t, { key: 'uk', name: 'UK', status: 'active' });
      await repo.promoteDefault(t, uk.id);
      await repo.create(t, { key: 'closing', name: 'Closing', status: 'active' });
    });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  /** A read-model whose source is the real repository, as in production. */
  const freshReadModel = (): ChannelReadModel =>
    new ChannelReadModel({
      findByKey: (tenant, key) => asT(() => repo.findByKey(tenant, key)),
      findById: (tenant, id) => asT(() => repo.findById(tenant, id)),
      findDefault: (tenant) => asT(() => repo.findDefault(tenant)),
      listActive: (tenant) => asT(() => repo.listActive(tenant)),
    });

  it('THE GAP: a dropped archive leaves a stale hit that read-through cannot fix', async () => {
    const rm = freshReadModel();
    expect(await rm.findByKey(t, 'closing')).not.toBeNull(); // warm it

    // Archive directly in the database — no service, so no event. This is
    // what a dropped `channels.archived` looks like from the consumer's side.
    await asT(async () => {
      const reserved = currentTenantBinding()!.reserved;
      await reserved`UPDATE channels.channels SET status = 'archived' WHERE tenant_id = ${t} AND key = 'closing'`;
    });

    // Still resolves. A hit never asks the source, so it cannot find out.
    expect(await rm.findByKey(t, 'closing')).not.toBeNull();
    expect(rm.stats.sourceReads).toBe(1);
  });

  it('reconciliation removes it, within one interval', async () => {
    // Self-contained: a FRESH read-model is not stale -- it reads through and
    // correctly sees the archive. Staleness has to be manufactured here, by
    // warming the replica while the channel is live and then archiving behind
    // its back. (The first draft of this test relied on the previous test's
    // state and asserted a stale hit that a fresh instance cannot have.)
    const key = `stale-${randomUUID().slice(0, 6)}`;
    await asT(() => repo.create(t, { key, name: 'Stale', status: 'active' }));
    const rm = freshReadModel();
    expect(await rm.findByKey(t, key)).not.toBeNull(); // warm
    await asT(async () => {
      const reserved = currentTenantBinding()!.reserved;
      await reserved`UPDATE channels.channels SET status = 'archived' WHERE tenant_id = ${t} AND key = ${key}`;
    });
    expect(await rm.findByKey(t, key)).not.toBeNull(); // stale hit, the gap
    const reconciler = new ChannelReconciler(sql, rm);

    const result = await reconciler.reconcile();

    expect(result.applied).toBe(true);
    // Gone from the replica; the subsequent read-through asks the source,
    // which also says no. The consumer now rejects the closed market.
    expect(await rm.findByKey(t, key)).toBeNull();
    // And the live one survived the swap.
    expect(await rm.findByKey(t, 'uk')).not.toBeNull();
  });

  it('reads a NON-ZERO count — the assertion that stops 0 = 0 passing', async () => {
    const result = await new ChannelReconciler(sql, freshReadModel()).reconcile();
    expect(result.channels).toBeGreaterThan(0);
    expect(result.tenants).toBeGreaterThan(0);
  });

  it('without app.system_worker the same query sees nothing', async () => {
    // Proves the RLS clause is load-bearing. If this returned rows, the reload
    // would be working for some other reason — and that reason would be a
    // table that any unbound connection can read.
    const rows = await sql`SELECT count(*)::int AS n FROM channels.channels`;
    expect(rows[0]!['n']).toBe(0);
  });

  it('a zero-row read leaves the replica UNTOUCHED rather than wiping it', async () => {
    // Simulate a blinded reconciler: same class, a connection where the
    // system_worker binding is a no-op. The safe response to "I read nothing"
    // is to change nothing and say so — wiping a warm replica would turn the
    // fault into a read-through storm against a database that then answers
    // correctly, hiding the very problem.
    const rm = freshReadModel();
    await rm.findByKey(t, 'uk');
    expect(rm.stats.size).toBe(1);

    const blinded = {
      begin: async (fn: (tx: unknown) => Promise<unknown>) => {
        // A tx that ignores set_config and returns no rows.
        const tx = Object.assign(async () => [], {});
        return fn(tx);
      },
    } as unknown as Sql;
    const result = await new ChannelReconciler(blinded, rm).reconcile();

    expect(result.applied).toBe(false);
    expect(result.channels).toBe(0);
    expect(rm.stats.size).toBe(1); // still warm
    expect(await rm.findByKey(t, 'uk')).not.toBeNull();
  });
});
