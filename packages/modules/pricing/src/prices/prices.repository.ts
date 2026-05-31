import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TENANT_DRIZZLE, type TenantDrizzleAccessor } from '@platform/shared/database';
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

  async findByTenant(tenantId: string, limit = 50): Promise<readonly Price[]> {
    const rows = await this.db
      .select()
      .from(prices)
      .where(eq(prices.tenantId, tenantId))
      .limit(Math.min(limit, 500));
    return rows.map(toDomain);
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
