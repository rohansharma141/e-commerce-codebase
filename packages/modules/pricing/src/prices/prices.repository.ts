import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  TENANT_DRIZZLE,
  clampLimit,
  decodeCursor,
  toPage,
  type TenantDrizzleAccessor,
} from '@platform/shared/database';
import type { IPricesQuery, Price } from '@platform/modules/pricing/contracts';
import { prices, type PriceRow } from '../db/schema';

@Injectable()
export class PricesRepository implements IPricesQuery {
  constructor(@Inject(TENANT_DRIZZLE) private readonly accessor: TenantDrizzleAccessor) {}
  private get db() {
    return this.accessor.get();
  }

  async upsert(tenantId: string, productId: string, unitPriceCents: number): Promise<Price> {
    const [row] = await this.db
      .insert(prices)
      .values({ tenantId, productId, unitPriceCents, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [prices.tenantId, prices.productId],
        set: { unitPriceCents, updatedAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error('prices upsert returned no row');
    return toDomain(row);
  }

  async bulkUpsert(
    tenantId: string,
    items: readonly { productId: string; unitPriceCents: number }[],
  ): Promise<number> {
    if (items.length === 0) return 0;
    const result = await this.db
      .insert(prices)
      .values(items.map((i) => ({ tenantId, productId: i.productId, unitPriceCents: i.unitPriceCents })))
      .onConflictDoUpdate({
        target: [prices.tenantId, prices.productId],
        set: {
          unitPriceCents: sql`excluded.unit_price_cents`,
          updatedAt: sql`now()`,
        },
      });
    // drizzle-orm/postgres-js doesn't surface rowCount on bulk insert returns
    // by default; we assume success and report items.length for caller logging.
    void result;
    return items.length;
  }

  /**
   * Paged by `product_id`, which is the only stable choice here: `pricing.prices`
   * is keyed on `(tenant_id, product_id)` and has no `id` column, and its
   * `updated_at` is hopelessly non-unique — the seeded data holds 99,004 rows
   * across 103 distinct timestamps, so a timestamp keyset would skip roughly
   * 960 rows at every page boundary.
   *
   * This replaces an unordered `findByTenant`. Without an ORDER BY, "the first
   * 50 prices" was not a stable set between two identical calls, which is also
   * why cursoring could not have been bolted on without fixing the order first.
   */
  async listPage(
    tenantId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: readonly Price[]; nextCursor: string | null }> {
    const cap = clampLimit(opts.limit);
    const keyset = opts.cursor ? decodeCursor(opts.cursor, 1) : undefined;
    const where = keyset
      ? and(eq(prices.tenantId, tenantId), gt(prices.productId, keyset[0] as string))
      : eq(prices.tenantId, tenantId);

    const rows = await this.db
      .select()
      .from(prices)
      .where(where)
      .orderBy(asc(prices.productId))
      .limit(cap + 1);

    const page = toPage(rows, cap, (row) => [row.productId]);
    return { items: page.items.map(toDomain), nextCursor: page.nextCursor };
  }

  async findByProductIds(
    tenantId: string,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, Price>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(prices)
      .where(and(eq(prices.tenantId, tenantId), inArray(prices.productId, productIds as string[])));
    const map = new Map<string, Price>();
    for (const r of rows) map.set(r.productId, toDomain(r));
    return map;
  }
}

function toDomain(row: PriceRow): Price {
  return {
    tenantId: row.tenantId,
    productId: row.productId,
    unitPriceCents: row.unitPriceCents,
    updatedAt: row.updatedAt.toISOString(),
  };
}
