/**
 * RLS isolation integration test — the "demonstration test" CLAUDE.md mandates.
 *
 * The previous step (step 2) enforces tenant scoping only at the app layer via
 * WHERE clauses inside repositories. This step adds Postgres row-level security
 * on catalog.* and pins app.tenant_id per request. This test proves it works
 * by bypassing the app filter entirely — running raw `SELECT * FROM catalog.*`
 * with no WHERE clause on a connection bound to one tenant, and asserting only
 * that tenant's rows come back.
 *
 * The "no binding → 0 rows" assertion is the load-bearing one: if RLS were
 * silently disabled, that query would return ALL rows from both tenants.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import {
  MigrationRunner,
  currentTenantBinding,
  withTenantConnection,
} from '@platform/shared/database';

const TEST_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_URL ? describe : describe.skip;

describeIfDb('catalog RLS isolation', () => {
  let sql: Sql;
  const t1 = `t1-${randomUUID().slice(0, 8)}`;
  const t2 = `t2-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    sql = postgres(TEST_URL as string, { max: 4 });

    const runner = new MigrationRunner(sql);
    await sql.unsafe('DROP SCHEMA IF EXISTS catalog CASCADE');
    await runner.apply(join(__dirname, 'db', 'migrations'), 'catalog');

    // Seed two tenants' worth of rows. Each insert runs inside its tenant's
    // binding, so the WITH CHECK clause on the policy accepts the row.
    await withTenantConnection(sql, t1, async () => {
      const reserved = currentTenantBinding()!.reserved;
      await reserved`
        INSERT INTO catalog.products (tenant_id, sku, name)
        VALUES (${t1}, 'A1', 'tenant-1 product')
      `;
    });
    await withTenantConnection(sql, t2, async () => {
      const reserved = currentTenantBinding()!.reserved;
      await reserved`
        INSERT INTO catalog.products (tenant_id, sku, name)
        VALUES (${t2}, 'B1', 'tenant-2 product')
      `;
    });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('a tenant-bound connection sees only its tenant rows via raw SELECT *', async () => {
    await withTenantConnection(sql, t1, async () => {
      const reserved = currentTenantBinding()!.reserved;
      const rows = await reserved<{ tenant_id: string }[]>`
        SELECT tenant_id FROM catalog.products
      `;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === t1)).toBe(true);
    });

    await withTenantConnection(sql, t2, async () => {
      const reserved = currentTenantBinding()!.reserved;
      const rows = await reserved<{ tenant_id: string }[]>`
        SELECT tenant_id FROM catalog.products
      `;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === t2)).toBe(true);
    });
  });

  it('a connection without any tenant binding returns ZERO rows (the killshot)', async () => {
    // This is the load-bearing assertion: the singleton sql client never had
    // app.tenant_id set, so current_setting('app.tenant_id', true) returns
    // NULL, the policy evaluates to (tenant_id = NULL) = false, and the
    // policy denies every row. If RLS were off, this would return both rows.
    const reserved = await sql.reserve();
    try {
      const rows = await reserved<{ id: string }[]>`SELECT id FROM catalog.products`;
      expect(rows).toEqual([]);
    } finally {
      reserved.release();
    }
  });

  it('a tenant-bound connection cannot INSERT a row for another tenant (WITH CHECK)', async () => {
    await withTenantConnection(sql, t1, async () => {
      const reserved = currentTenantBinding()!.reserved;
      await expect(
        reserved`
          INSERT INTO catalog.products (tenant_id, sku, name)
          VALUES (${t2}, 'X-CROSS', 'should fail')
        `,
      ).rejects.toThrow(/row-level security|new row violates row-level security/i);
    });
  });

  it('attribute_definitions are equally isolated', async () => {
    await withTenantConnection(sql, t1, async () => {
      const reserved = currentTenantBinding()!.reserved;
      await reserved`
        INSERT INTO catalog.attribute_definitions (tenant_id, code, type, config)
        VALUES (${t1}, 'color', 'string', '{}'::jsonb)
      `;
    });

    const noBindingDefs = await (async () => {
      const reserved = await sql.reserve();
      try {
        return await reserved<{ id: string }[]>`SELECT id FROM catalog.attribute_definitions`;
      } finally {
        reserved.release();
      }
    })();
    expect(noBindingDefs).toEqual([]);

    await withTenantConnection(sql, t2, async () => {
      const reserved = currentTenantBinding()!.reserved;
      const rows = await reserved<{ code: string }[]>`
        SELECT code FROM catalog.attribute_definitions
      `;
      expect(rows).toEqual([]);
    });
  });

  it('rebinding to a different tenant on a fresh reservation does NOT leak the previous tenant', async () => {
    // Each call to withTenantConnection reserves a NEW connection, so
    // app.tenant_id from the previous reservation should never carry over.
    // This test makes that explicit: bind t1, bind t2 sequentially, confirm
    // t2's view does not contain t1's rows.
    await withTenantConnection(sql, t1, async () => {
      const reserved = currentTenantBinding()!.reserved;
      const t1Rows = await reserved<{ tenant_id: string }[]>`SELECT tenant_id FROM catalog.products`;
      expect(t1Rows.every((r) => r.tenant_id === t1)).toBe(true);
    });

    await withTenantConnection(sql, t2, async () => {
      const reserved = currentTenantBinding()!.reserved;
      const t2Rows = await reserved<{ tenant_id: string }[]>`SELECT tenant_id FROM catalog.products`;
      expect(t2Rows.every((r) => r.tenant_id === t2)).toBe(true);
      expect(t2Rows.some((r) => r.tenant_id === t1)).toBe(false);
    });
  });
});
