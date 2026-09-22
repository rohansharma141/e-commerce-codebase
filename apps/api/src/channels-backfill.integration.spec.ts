/**
 * C-11: channels' safety backfill (0003_safety_backfill.sql), run the way the
 * migration runner runs it — the file's contents, as `platform`, on one
 * connection, inside a transaction, with no tenant bound.
 *
 * ── Why every test rolls back ─────────────────────────────────────────────
 *
 * The backfill acts on *every* tenant in pricing.tenant_config that has no
 * channel. On a database other suites share — CI runs every project's tests
 * at once against one Postgres — committing it would hand a default channel to
 * whichever tenant another suite had half set up, and that suite would then
 * fail to create its own. So each test builds its pre-channels state, runs the
 * migration and asserts inside one transaction, then rolls back. Nothing here
 * is ever committed, and no schema is dropped.
 *
 * ── What it would print if the migration did nothing ──────────────────────
 *
 * `expected 2, received 0` on the count of backfilled tenants. That is the
 * shape this project has shipped before — a backfill reporting success over
 * rows RLS hid from it — so the count is asserted exactly, never as `>= 0`
 * and never as "source count equals target count".
 *
 * Lives in apps/api because it reads two modules' migrations; like
 * checkout.integration, that is composition-root work.
 *
 * Run with a throwaway database (docs/RUNBOOK.md#running-the-live-suites):
 *
 *     TEST_DATABASE_URL=postgres://platform:platform@localhost:5432/platform_test \
 *       pnpm nx test api --skipNxCache -- --testPathPattern=channels-backfill
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { MigrationRunner } from '@platform/shared/database';

const MODULES = join(__dirname, '..', '..', '..', 'packages', 'modules');
const PRICING_MIGRATIONS = join(MODULES, 'pricing', 'src', 'db', 'migrations');
const CHANNELS_MIGRATIONS = join(MODULES, 'channels', 'src', 'db', 'migrations');
const BACKFILL = readFileSync(join(CHANNELS_MIGRATIONS, '0003_safety_backfill.sql'), 'utf8');

const PG_URL = process.env['TEST_DATABASE_URL'];
const describeIf = PG_URL ? describe : describe.skip;

jest.setTimeout(30_000);

type Conn = Awaited<ReturnType<Sql['reserve']>>;

interface ChannelRow {
  key: string;
  name: string;
  status: string;
  is_default: boolean;
  currency_code: string | null;
  default_locale: string | null;
  supported_locales: string[] | null;
  country: string | null;
  timezone: string | null;
  tax_display: string | null;
  tax_rate_bps: number | null;
}

interface DefaultsRow {
  currency_code: string;
  default_locale: string;
  supported_locales: string[];
  country: string;
  timezone: string;
  tax_display: string;
  tax_rate_bps: number | null;
}

describeIf('C-11 safety backfill (channels 0003)', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = postgres(PG_URL as string, { max: 2 });
    // Idempotent: the ledger skips whatever is already applied. No schema is
    // dropped, so this is safe beside suites that share the database.
    const runner = new MigrationRunner(sql);
    await runner.apply(PRICING_MIGRATIONS, 'pricing');
    await runner.apply(CHANNELS_MIGRATIONS, 'channels');
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  /** One connection, one transaction, always rolled back. */
  async function inRolledBackTx(fn: (conn: Conn) => Promise<void>): Promise<void> {
    const conn = await sql.reserve();
    try {
      await conn.unsafe('BEGIN');
      await fn(conn);
    } finally {
      await conn.unsafe('ROLLBACK');
      conn.release();
    }
  }

  /** Transaction-local, so it ends with the rollback. */
  const bind = (conn: Conn, tenantId: string) =>
    conn`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

  /** The runner binds no tenant; an empty value fails every policy the same way. */
  const unbind = (conn: Conn) => conn`SELECT set_config('app.tenant_id', '', true)`;

  /**
   * Three tenants with pricing config, as `main` left them. `a` and `b` have
   * no channels — the case the backfill exists for. `c` already has a channel
   * and defaults that disagree with its pricing row, so any overwrite shows.
   */
  async function arrangePreChannelsState(conn: Conn) {
    const suffix = randomUUID().slice(0, 8);
    const t = { a: `c11a-${suffix}`, b: `c11b-${suffix}`, c: `c11c-${suffix}` };
    const pricing: ReadonlyArray<readonly [string, string, string, number]> = [
      [t.a, 'GBP', 'en-GB', 875],
      [t.b, 'USD', 'en-US', 0],
      [t.c, 'USD', 'en-US', 0],
    ];
    for (const [tenantId, currency, locale, bps] of pricing) {
      await bind(conn, tenantId);
      await conn`
        INSERT INTO pricing.tenant_config (tenant_id, currency, tax_rate_bps, locale)
        VALUES (${tenantId}, ${currency}, ${bps}, ${locale})`;
    }
    await bind(conn, t.c);
    await conn`
      INSERT INTO channels.tenant_defaults
        (tenant_id, currency_code, default_locale, supported_locales, country, timezone,
         tax_display, tax_rate_bps)
      VALUES (${t.c}, 'EUR', 'de-DE', ${conn.array(['de-DE'])}, 'DE', 'Europe/Berlin', 'net', 1900)`;
    await conn`
      INSERT INTO channels.channels (tenant_id, key, name, status, is_default)
      VALUES (${t.c}, 'uk', 'Existing Store', 'active', true)`;
    await unbind(conn);
    return t;
  }

  /** Read as the tenant, through RLS — the path the api takes. */
  async function channelsOf(conn: Conn, tenantId: string): Promise<ChannelRow[]> {
    await bind(conn, tenantId);
    const rows = await conn<ChannelRow[]>`
      SELECT key, name, status, is_default, currency_code, default_locale, supported_locales,
             country, timezone, tax_display, tax_rate_bps
        FROM channels.channels ORDER BY key`;
    await unbind(conn);
    return rows;
  }

  async function defaultsOf(conn: Conn, tenantId: string): Promise<DefaultsRow | undefined> {
    await bind(conn, tenantId);
    const [row] = await conn<DefaultsRow[]>`
      SELECT currency_code, default_locale, supported_locales, country, timezone,
             tax_display, tax_rate_bps
        FROM channels.tenant_defaults`;
    await unbind(conn);
    return row;
  }

  const INHERITS_EVERYTHING = {
    currency_code: null,
    default_locale: null,
    supported_locales: null,
    country: null,
    timezone: null,
    tax_display: null,
    tax_rate_bps: null,
  };

  it('gives exactly the tenants with no channel one active, inheriting default -- two, not zero', async () => {
    await inRolledBackTx(async (conn) => {
      const t = await arrangePreChannelsState(conn);
      expect(await channelsOf(conn, t.a)).toHaveLength(0); // the state is what it claims

      await conn.unsafe(BACKFILL);

      const backfilled: string[] = [];
      for (const tenantId of [t.a, t.b, t.c]) {
        const rows = await channelsOf(conn, tenantId);
        if (rows.some((r) => r.key === 'web')) backfilled.push(tenantId);
      }
      expect(backfilled).toEqual([t.a, t.b]);

      for (const tenantId of [t.a, t.b]) {
        expect(await channelsOf(conn, tenantId)).toEqual([
          { key: 'web', name: 'Web Store', status: 'active', is_default: true, ...INHERITS_EVERYTHING },
        ]);
      }
    });
  });

  it('copies currency, locale and tax rate, and writes the stated defaults for the rest', async () => {
    await inRolledBackTx(async (conn) => {
      const t = await arrangePreChannelsState(conn);
      await conn.unsafe(BACKFILL);

      expect(await defaultsOf(conn, t.a)).toEqual({
        currency_code: 'GBP',
        default_locale: 'en-GB',
        supported_locales: ['en-GB'],
        country: 'US',
        timezone: 'UTC',
        tax_display: 'net',
        tax_rate_bps: 875,
      });
      expect(await defaultsOf(conn, t.b)).toMatchObject({ currency_code: 'USD', tax_rate_bps: 0 });
    });
  });

  it('leaves a tenant that already has a channel exactly as it was', async () => {
    await inRolledBackTx(async (conn) => {
      const t = await arrangePreChannelsState(conn);
      await conn.unsafe(BACKFILL);

      const rows = await channelsOf(conn, t.c);
      expect(rows.map((r) => [r.key, r.is_default])).toEqual([['uk', true]]);
      expect(await defaultsOf(conn, t.c)).toMatchObject({ currency_code: 'EUR', tax_rate_bps: 1900 });
    });
  });

  it('changes nothing when run a second time', async () => {
    await inRolledBackTx(async (conn) => {
      const t = await arrangePreChannelsState(conn);
      await conn.unsafe(BACKFILL);
      await conn.unsafe(BACKFILL);

      expect(await channelsOf(conn, t.a)).toHaveLength(1);
      expect(await channelsOf(conn, t.c)).toHaveLength(1);
    });
  });

  it('puts FORCE back on all three tables, and RLS is enforced again', async () => {
    await inRolledBackTx(async (conn) => {
      const t = await arrangePreChannelsState(conn);
      await conn.unsafe(BACKFILL);

      const forced = await conn<{ name: string; force: boolean }[]>`
        SELECT c.oid::regclass::text AS name, c.relforcerowsecurity AS force
          FROM pg_class c
         WHERE c.oid IN ('pricing.tenant_config'::regclass,
                         'channels.tenant_defaults'::regclass,
                         'channels.channels'::regclass)
         ORDER BY 1`;
      expect(forced).toEqual([
        { name: 'channels.channels', force: true },
        { name: 'channels.tenant_defaults', force: true },
        { name: 'pricing.tenant_config', force: true },
      ]);

      // The flag is not the behaviour. Unbound, the owner sees none of the
      // rows it has just written; bound as the tenant, it sees its own.
      await unbind(conn);
      const unbound = await conn`
        SELECT 1 FROM channels.channels WHERE tenant_id IN (${t.a}, ${t.b})`;
      expect(unbound).toHaveLength(0);
      expect(await channelsOf(conn, t.a)).toHaveLength(1);
    });
  });

  it('skips, without failing, when pricing.tenant_config does not exist (fresh database, pricing not yet migrated)', async () => {
    await inRolledBackTx(async (conn) => {
      const t = await arrangePreChannelsState(conn);
      await conn.unsafe('ALTER TABLE pricing.tenant_config RENAME TO tenant_config_c11_hidden');

      await expect(conn.unsafe(BACKFILL)).resolves.toBeDefined();
      expect(await channelsOf(conn, t.a)).toHaveLength(0);
    });
  });

  it('skips, without failing, when a column it reads has been dropped by a later pricing migration', async () => {
    await inRolledBackTx(async (conn) => {
      const t = await arrangePreChannelsState(conn);
      await conn.unsafe('ALTER TABLE pricing.tenant_config RENAME COLUMN locale TO locale_c11_hidden');

      await expect(conn.unsafe(BACKFILL)).resolves.toBeDefined();
      expect(await channelsOf(conn, t.a)).toHaveLength(0);
    });
  });
});
