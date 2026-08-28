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
import { ChannelsRepository, VersionConflictError } from './channels.repository';

/**
 * Schema, RLS and repository behaviour — the checks for C-5 and C-7.
 *
 * ⚠️ **THIS SPEC HAS NEVER BEEN EXECUTED.** It was written alongside code that
 * was authored without a database available, at the user's explicit direction.
 * It compiles and it is gated on `TEST_DATABASE_URL`, so it skips silently —
 * which means a green test run today says nothing whatsoever about any of the
 * code it covers. Treat every assertion below as a stated intention rather
 * than a result until it has been run and this banner removed.
 *
 * Run it with:
 *
 *     docker compose up -d
 *     TEST_DATABASE_URL=postgres://platform:platform@localhost:5432/platform \
 *       pnpm nx test channels-src --skipNxCache
 *
 * It drops and rebuilds the `channels` schema, so do not point it at a
 * database you intend to demo from.
 *
 * ── What each check would print if the thing under test did nothing ───────
 *
 * The RLS checks are the ones most able to pass vacuously, and this project
 * has the scars: a backfill once reported "row counts match" as `0 = 0`
 * because RLS hid the source rows, and the README's isolation proof once
 * returned `0 / 0 / 0` against an empty table and read as a pass. So every
 * isolation assertion here is paired with a **non-zero** assertion on the same
 * connection — proving the query can see something before proving it cannot
 * see the wrong thing.
 */

const TEST_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_URL ? describe : describe.skip;

jest.setTimeout(60_000);

describeIfDb('channels schema, RLS and repository', () => {
  let sql: Sql;
  let repo: ChannelsRepository;

  const t1 = `t1-${randomUUID().slice(0, 8)}`;
  const t2 = `t2-${randomUUID().slice(0, 8)}`;

  const asT = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    runWithTenant({ tenantId, requestId: randomUUID() }, () =>
      withTenantConnection(sql, tenantId, fn),
    );

  const defaultsFor = (tenantId: string) => ({
    currencyCode: 'USD',
    defaultLocale: 'en-US',
    supportedLocales: ['en-US'] as const,
    country: 'US',
    timezone: 'America/New_York',
    taxDisplay: 'net' as const,
    taxRateBps: 875,
    tenantId,
  });

  beforeAll(async () => {
    sql = postgres(TEST_URL as string, { max: 6 });
    const runner = new MigrationRunner(sql);
    await sql.unsafe('DROP SCHEMA IF EXISTS channels CASCADE');
    await runner.apply(join(__dirname, 'db', 'migrations'), 'channels');

    repo = new ChannelsRepository(tenantDrizzleAccessor);

    for (const t of [t1, t2]) {
      const d = defaultsFor(t);
      await asT(t, async () => {
        await repo.upsertTenantDefaults(t, d);
        await repo.create(t, { key: 'us', name: 'United States', status: 'active' });
        await repo.promoteDefault(t, (await firstChannelId(t)) as string);
      });
    }
  });

  const firstChannelId = async (t: string): Promise<string | undefined> => {
    const all = await repo.list(t);
    return all[0]?.config.channelId;
  };

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  // ── C-5: schema and RLS ─────────────────────────────────────────────────

  describe('RLS', () => {
    it('a tenant sees its own channels — and more than zero of them', async () => {
      // The non-vacuous half. Without it, every isolation assertion below
      // would pass against a policy that hides everything from everyone.
      const rows = await asT(t1, async () => {
        const reserved = currentTenantBinding()!.reserved;
        return reserved`SELECT tenant_id FROM channels.channels`;
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r['tenant_id'] === t1)).toBe(true);
    });

    it('an unbound connection sees no channels at all', async () => {
      // If RLS were disabled this returns every tenant's rows.
      const rows = await sql`SELECT tenant_id FROM channels.channels`;
      expect(rows).toHaveLength(0);
    });

    it('BOTH channels of one tenant are visible — there is no channel policy', async () => {
      // The negative control ADR-0014 asks for. RLS is keyed on tenant_id
      // ONLY: a channel is scope selection within an already-resolved tenant,
      // and a channel-level policy would imply channels distrust each other,
      // which is not the model. If someone later "hardens" this by adding a
      // channel clause, this is the test that fails.
      await asT(t1, async () => {
        await repo.create(t1, { key: 'eu', name: 'Europe', status: 'active' });
      });
      const rows = await asT(t1, async () => {
        const reserved = currentTenantBinding()!.reserved;
        return reserved`SELECT key FROM channels.channels ORDER BY key`;
      });
      expect(rows.map((r) => r['key'])).toEqual(['eu', 'us']);
    });

    it('the system-worker escape hatch sees across tenants, and is off by default', async () => {
      // Reconciliation (C-15) runs on a timer with no bound tenant. Without
      // this clause RLS feeds it zero rows and it reports success having read
      // nothing — the `0 = 0` scar.
      const withoutFlag = await sql`SELECT 1 FROM channels.channels`;
      expect(withoutFlag).toHaveLength(0);

      const withFlag = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.system_worker', 'on', true)`;
        return tx`SELECT DISTINCT tenant_id FROM channels.channels`;
      });
      const tenants = withFlag.map((r) => r['tenant_id']);
      expect(tenants).toEqual(expect.arrayContaining([t1, t2]));
    });
  });

  describe('constraints', () => {
    it('rejects a second default for the same tenant', async () => {
      // The partial unique index. An application-only guarantee of "exactly
      // one default" fails open, which is why this is DDL.
      await expect(
        asT(t1, async () => {
          const reserved = currentTenantBinding()!.reserved;
          await reserved`
            INSERT INTO channels.channels (tenant_id, key, name, status, is_default)
            VALUES (${t1}, 'second-default', 'Second', 'active', true)
          `;
        }),
      ).rejects.toThrow();
    });

    it('allows the same key under two different tenants', async () => {
      // Keys are unique per tenant, not globally. Both tenants have 'us'.
      const a = await asT(t1, () => repo.findByKey(t1, 'us'));
      const b = await asT(t2, () => repo.findByKey(t2, 'us'));
      expect(a?.tenantId).toBe(t1);
      expect(b?.tenantId).toBe(t2);
    });

    it('rejects a key that would break a URL path', async () => {
      await expect(
        asT(t1, () => repo.create(t1, { key: 'Not/Valid', name: 'bad' })),
      ).rejects.toThrow();
    });
  });

  // ── C-7: repository and resolution ──────────────────────────────────────

  describe('resolution', () => {
    it('a channel overriding nothing resolves to tenant defaults', async () => {
      const cfg = await asT(t1, async () => {
        await repo.create(t1, { key: 'inherit-all', name: 'Inheriting', status: 'active' });
        return repo.findByKey(t1, 'inherit-all');
      });
      expect(cfg?.currencyCode).toBe('USD');
      expect(cfg?.country).toBe('US');
      expect(cfg?.taxRateBps).toBe(875);
    });

    it('an override wins and changes only its own field', async () => {
      // Both directions. With the coalesce inverted the inherit test above
      // fails while this one still passes, so neither alone is sufficient.
      const cfg = await asT(t1, async () => {
        await repo.create(t1, {
          key: 'gb',
          name: 'Great Britain',
          status: 'active',
          currencyCode: 'GBP',
        });
        return repo.findByKey(t1, 'gb');
      });
      expect(cfg?.currencyCode).toBe('GBP');
      expect(cfg?.currencyMinorUnits).toBe(2);
      expect(cfg?.country).toBe('US'); // still inherited
    });

    it('derives minor units from the resolved currency', async () => {
      const cfg = await asT(t1, async () => {
        await repo.create(t1, {
          key: 'jp',
          name: 'Japan',
          status: 'active',
          currencyCode: 'JPY',
        });
        return repo.findByKey(t1, 'jp');
      });
      expect(cfg?.currencyMinorUnits).toBe(0);
    });

    it('a tenant-defaults edit changes every inheriting channel at once', async () => {
      // The reason inheritance exists. One edit, not fifteen.
      await asT(t2, async () => {
        const current = await repo.findTenantDefaults(t2);
        await repo.updateTenantDefaults(t2, { taxRateBps: 2000 }, current!.version);
      });
      const cfg = await asT(t2, () => repo.findByKey(t2, 'us'));
      expect(cfg?.taxRateBps).toBe(2000);
    });
  });

  describe('lookup', () => {
    it('an unknown key resolves to null, never to the default', async () => {
      // Silent fallback means a typo serves a different market's prices and
      // looks like it worked.
      expect(await asT(t1, () => repo.findByKey(t1, 'no-such-channel'))).toBeNull();
    });

    it('an archived channel resolves to null, not to a working one', async () => {
      const cfg = await asT(t1, async () => {
        const ch = await repo.create(t1, { key: 'closing', name: 'Closing', status: 'active' });
        await repo.update(t1, ch.id, { status: 'archived' }, ch.version);
        return repo.findByKey(t1, 'closing');
      });
      expect(cfg).toBeNull();
    });

    it("another tenant's channel key is invisible", async () => {
      await asT(t2, () => repo.create(t2, { key: 't2-only', name: 'T2', status: 'active' }));
      expect(await asT(t1, () => repo.findByKey(t1, 't2-only'))).toBeNull();
    });
  });

  describe('optimistic concurrency', () => {
    it('a second write with a stale version is rejected', async () => {
      // Without version checking both succeed and the first edit is lost
      // silently — invisible with one operator, routine with two.
      await asT(t1, async () => {
        const ch = await repo.create(t1, { key: 'concurrent', name: 'First' });
        await repo.update(t1, ch.id, { name: 'Second' }, ch.version);
        await expect(
          repo.update(t1, ch.id, { name: 'Third' }, ch.version),
        ).rejects.toBeInstanceOf(VersionConflictError);
      });
    });

    it('the conflict carries the current version so a client can re-read', async () => {
      await asT(t1, async () => {
        const ch = await repo.create(t1, { key: 'conflict-v', name: 'A' });
        const updated = await repo.update(t1, ch.id, { name: 'B' }, ch.version);
        try {
          await repo.update(t1, ch.id, { name: 'C' }, ch.version);
          throw new Error('expected a conflict');
        } catch (e) {
          expect((e as VersionConflictError).currentVersion).toBe(updated.version);
        }
      });
    });
  });

  describe('PATCH merge semantics', () => {
    it('an omitted field is left alone; an explicit null resumes inheriting', async () => {
      // The distinction that makes "stop overriding this" expressible.
      await asT(t1, async () => {
        const ch = await repo.create(t1, {
          key: 'merge',
          name: 'Merge',
          status: 'active',
          currencyCode: 'GBP',
          country: 'GB',
        });

        // Omitting currencyCode must not clear it.
        const v2 = await repo.update(t1, ch.id, { name: 'Renamed' }, ch.version);
        expect((await repo.getRaw(t1, ch.id))?.currencyCode).toBe('GBP');

        // Explicit null clears the override, so it inherits again.
        await repo.update(t1, ch.id, { currencyCode: null }, v2.version);
        expect((await repo.getRaw(t1, ch.id))?.currencyCode).toBeNull();
        expect((await repo.findByKey(t1, 'merge'))?.currencyCode).toBe('USD');
      });
    });
  });

  describe('default promotion', () => {
    it('promoting moves the flag rather than adding a second default', async () => {
      await asT(t1, async () => {
        const ch = await repo.create(t1, { key: 'promote-me', name: 'P', status: 'active' });
        await repo.promoteDefault(t1, ch.id);

        const all = await repo.list(t1);
        expect(all.filter((c) => c.config.isDefault).map((c) => c.config.key)).toEqual([
          'promote-me',
        ]);
      });
    });

    it('two concurrent promotions leave exactly one default, not a constraint violation', async () => {
      // The race the partial unique index creates. Doing the unset and the set
      // as two statements outside a transaction surfaces this as an
      // intermittent failure in production and nowhere else.
      const [a, b] = await asT(t1, async () => [
        await repo.create(t1, { key: 'race-a', name: 'A', status: 'active' }),
        await repo.create(t1, { key: 'race-b', name: 'B', status: 'active' }),
      ]);

      await Promise.all([
        asT(t1, () => repo.promoteDefault(t1, a.id)),
        asT(t1, () => repo.promoteDefault(t1, b.id)),
      ]);

      const defaults = (await asT(t1, () => repo.list(t1))).filter((c) => c.config.isDefault);
      expect(defaults).toHaveLength(1);
      expect(['race-a', 'race-b']).toContain(defaults[0]?.config.key);
    });
  });
});
