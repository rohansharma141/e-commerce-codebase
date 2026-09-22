/**
 * C-33: orders' channel backfill — why 0003's never ran, and 0004 doing it
 * properly. Both files are run the way the migration runner runs them: the
 * contents, as `platform`, on one connection, in a transaction, no tenant
 * bound.
 *
 * ── THE BUG, kept on purpose ──────────────────────────────────────────────
 *
 * 0003_channel_snapshot.sql backfills channel_id from the tenant's default
 * channel, and its comment says the migration "runs as the table owner, so it
 * is not subject to the FORCE RLS policy". FORCE is what makes the policy
 * apply to the owner. `platform` is NOSUPERUSER NOBYPASSRLS, so both tables
 * look empty to that UPDATE and it succeeds having changed nothing. 0003 is
 * immutable once applied — the runner checksums it — so the test proving it
 * is a no-op stays green permanently, as the record of why 0004 exists. If it
 * ever fails, 0003 has been edited, which would stop every existing database
 * from booting.
 *
 * ── What it would print if 0004 did nothing ───────────────────────────────
 *
 * `null` where the default channel's id is expected.
 *
 * ── Why this one may commit ───────────────────────────────────────────────
 *
 * Unlike C-11's spec, which rolls back, 0004 only touches orders whose
 * channel_id is null, and every order checkout writes carries one. So on a
 * database other suites share it changes only this spec's probe orders, which
 * RLS keeps out of everyone else's sight and afterAll deletes. Committing is
 * what makes the leak check possible: a setting that outlives the transaction
 * is only visible after COMMIT.
 *
 * Run with a throwaway database (docs/RUNBOOK.md#running-the-live-suites):
 *
 *     TEST_DATABASE_URL=postgres://platform:platform@localhost:5432/platform_test \
 *       pnpm nx test api --skipNxCache -- --testPathPattern=orders-channel-backfill
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { MigrationRunner } from '@platform/shared/database';

const MODULES = join(__dirname, '..', '..', '..', 'packages', 'modules');
const CHANNELS_MIGRATIONS = join(MODULES, 'channels', 'src', 'db', 'migrations');
const ORDERS_MIGRATIONS = join(MODULES, 'orders', 'src', 'db', 'migrations');
const ORDERS_0003 = readFileSync(join(ORDERS_MIGRATIONS, '0003_channel_snapshot.sql'), 'utf8');
const ORDERS_0004 = readFileSync(join(ORDERS_MIGRATIONS, '0004_channel_backfill.sql'), 'utf8');

const PG_URL = process.env['TEST_DATABASE_URL'];
const describeIf = PG_URL ? describe : describe.skip;

jest.setTimeout(30_000);

type Conn = Awaited<ReturnType<Sql['reserve']>>;

describeIf('C-33 orders channel backfill (orders 0003 and 0004)', () => {
  let sql: Sql;
  /** One connection only, so the query after a migration runs on the same one. */
  let single: Sql;
  const probeTenants: string[] = [];

  beforeAll(async () => {
    sql = postgres(PG_URL as string, { max: 3 });
    single = postgres(PG_URL as string, { max: 1 });
    // Idempotent, and nothing is dropped: safe beside suites sharing the database.
    const runner = new MigrationRunner(sql);
    await runner.apply(CHANNELS_MIGRATIONS, 'channels');
    await runner.apply(ORDERS_MIGRATIONS, 'orders');
  });

  afterAll(async () => {
    for (const tenantId of probeTenants) {
      await asTenant(tenantId, async (conn) => {
        await conn`DELETE FROM orders.orders`;
        await conn`DELETE FROM channels.channels`;
      });
    }
    await single?.end({ timeout: 5 });
    await sql?.end({ timeout: 5 });
  });

  /** Exactly what MigrationRunner does with a file, minus the ledger row. */
  async function runAsRunner(pool: Sql, contents: string): Promise<void> {
    const conn = await pool.reserve();
    try {
      await conn.unsafe('BEGIN');
      try {
        await conn.unsafe(contents);
        await conn.unsafe('COMMIT');
      } catch (err) {
        await conn.unsafe('ROLLBACK');
        throw err;
      }
    } finally {
      conn.release();
    }
  }

  async function asTenant<T>(tenantId: string, fn: (conn: Conn) => Promise<T>): Promise<T> {
    const conn = await sql.reserve();
    try {
      await conn.unsafe('BEGIN');
      await conn`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const result = await fn(conn);
      await conn.unsafe('COMMIT');
      return result;
    } catch (err) {
      await conn.unsafe('ROLLBACK');
      throw err;
    } finally {
      conn.release();
    }
  }

  const insertOrder = (conn: Conn, tenantId: string, channelId: string | null) =>
    conn<{ id: string }[]>`
      INSERT INTO orders.orders
        (tenant_id, currency, subtotal_cents, tax_rate_bps, tax_cents, grand_total_cents, channel_id)
      VALUES (${tenantId}, 'GBP', 1000, 0, 0, 1000, ${channelId})
      RETURNING id`.then(([row]) => (row as { id: string }).id);

  /**
   * `p` has a default channel and two orders: one placed before channels
   * (null) and one that already names a channel. `q` has an order and no
   * channel at all, so there is nothing to attribute it to.
   */
  async function arrange() {
    const suffix = randomUUID().slice(0, 8);
    const p = `c33p-${suffix}`;
    const q = `c33q-${suffix}`;
    probeTenants.push(p, q);
    const elsewhere = randomUUID();

    const { defaultId, beforeChannels, attributed } = await asTenant(p, async (conn) => {
      const [channel] = await conn<{ id: string }[]>`
        INSERT INTO channels.channels (tenant_id, key, name, status, is_default)
        VALUES (${p}, 'web', 'Web Store', 'active', true)
        RETURNING id`;
      return {
        defaultId: (channel as { id: string }).id,
        beforeChannels: await insertOrder(conn, p, null),
        attributed: await insertOrder(conn, p, elsewhere),
      };
    });
    const orphan = await asTenant(q, (conn) => insertOrder(conn, q, null));
    return { p, q, defaultId, beforeChannels, attributed, elsewhere, orphan };
  }

  const channelOf = (tenantId: string, orderId: string) =>
    asTenant(tenantId, async (conn) => {
      const [row] = await conn<{ channel_id: string | null }[]>`
        SELECT channel_id FROM orders.orders WHERE id = ${orderId}`;
      return row?.channel_id;
    });

  it('THE BUG: 0003 alone attributes nothing, because FORCE RLS applies to the owner it runs as', async () => {
    const s = await arrange();
    // Not vacuous: the default it should have copied is really there.
    const defaults = await asTenant(s.p, (conn) =>
      conn`SELECT id FROM channels.channels WHERE is_default`);
    expect(defaults.map((r) => r['id'])).toEqual([s.defaultId]);

    await runAsRunner(sql, ORDERS_0003);

    expect(await channelOf(s.p, s.beforeChannels)).toBeNull();
  });

  it("THE FIX: 0004 attributes an order placed before channels to the tenant's default", async () => {
    const s = await arrange();
    await runAsRunner(single, ORDERS_0004);

    expect(await channelOf(s.p, s.beforeChannels)).toBe(s.defaultId);
  });

  it('leaves an order that already names a channel alone, and one with no default to copy null', async () => {
    const s = await arrange();
    await runAsRunner(single, ORDERS_0004);

    expect(await channelOf(s.p, s.attributed)).toBe(s.elsewhere);
    expect(await channelOf(s.q, s.orphan)).toBeNull();
  });

  it('changes nothing when run a second time', async () => {
    const s = await arrange();
    await runAsRunner(single, ORDERS_0004);
    await runAsRunner(single, ORDERS_0004);

    expect(await channelOf(s.p, s.beforeChannels)).toBe(s.defaultId);
    expect(await channelOf(s.p, s.attributed)).toBe(s.elsewhere);
  });

  it('puts FORCE back on orders.orders and leaves no app.system_worker on the pooled connection', async () => {
    const s = await arrange();
    await runAsRunner(single, ORDERS_0004);

    // The same, single, connection the migration just ran on and released.
    const [setting] = await single<{ v: string | null }[]>`
      SELECT current_setting('app.system_worker', true) AS v`;
    expect(setting?.v ?? '').toBe('');

    const [flag] = await sql<{ force: boolean }[]>`
      SELECT relforcerowsecurity AS force FROM pg_class WHERE oid = 'orders.orders'::regclass`;
    expect(flag?.force).toBe(true);

    // The flag is not the behaviour: unbound, the owner sees none of the rows.
    const unbound = await sql`SELECT 1 FROM orders.orders WHERE tenant_id = ${s.p}`;
    expect(unbound).toHaveLength(0);
  });

  it('skips, without failing, when channels.channels does not exist (orders migrating first)', async () => {
    const conn = await sql.reserve();
    try {
      await conn.unsafe('BEGIN');
      await conn.unsafe('ALTER TABLE channels.channels RENAME TO channels_c33_hidden');
      await expect(conn.unsafe(ORDERS_0004)).resolves.toBeDefined();
    } finally {
      await conn.unsafe('ROLLBACK');
      conn.release();
    }
  });
});
