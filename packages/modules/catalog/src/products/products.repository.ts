import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { DRIZZLE, type DrizzleClient } from '@platform/shared/database';
import type { Product, ProductAttributes } from '@platform/modules/catalog/contracts';
import { products, type ProductRow } from '../db/schema';

export interface NewProduct {
  readonly tenantId: string;
  readonly sku: string;
  readonly name: string;
  readonly attributes: ProductAttributes;
}

export interface ProductPatch {
  readonly sku?: string;
  readonly name?: string;
  readonly attributes?: ProductAttributes;
}

@Injectable()
export class ProductsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleClient) {}

  async insert(input: NewProduct): Promise<Product> {
    const [row] = await this.db
      .insert(products)
      .values({
        tenantId: input.tenantId,
        sku: input.sku,
        name: input.name,
        attributes: input.attributes,
      })
      .returning();
    if (!row) throw new Error('products insert returned no row');
    return toDomain(row);
  }

  async findById(tenantId: string, id: string): Promise<Product | null> {
    const rows = await this.db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async findBySku(tenantId: string, sku: string): Promise<Product | null> {
    const rows = await this.db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.sku, sku)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async list(
    tenantId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<{ items: readonly Product[]; nextCursor: string | null }> {
    const cap = Math.min(Math.max(opts.limit, 1), 100);
    const where = opts.cursor
      ? and(eq(products.tenantId, tenantId), gt(products.id, opts.cursor))
      : eq(products.tenantId, tenantId);

    const rows = await this.db
      .select()
      .from(products)
      .where(where)
      .orderBy(asc(products.id))
      .limit(cap + 1);

    const hasMore = rows.length > cap;
    const slice = hasMore ? rows.slice(0, cap) : rows;
    const items = slice.map(toDomain);
    const lastItem = items.length > 0 ? items[items.length - 1] : undefined;
    const nextCursor = hasMore && lastItem ? lastItem.id : null;
    return { items, nextCursor };
  }

  async update(tenantId: string, id: string, patch: ProductPatch): Promise<Product | null> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.sku !== undefined) values['sku'] = patch.sku;
    if (patch.name !== undefined) values['name'] = patch.name;
    if (patch.attributes !== undefined) values['attributes'] = patch.attributes;

    const [row] = await this.db
      .update(products)
      .set(values)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, id)))
      .returning();
    return row ? toDomain(row) : null;
  }

  async delete(tenantId: string, id: string): Promise<Product | null> {
    const [row] = await this.db
      .delete(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, id)))
      .returning();
    return row ? toDomain(row) : null;
  }
}

function toDomain(row: ProductRow): Product {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sku: row.sku,
    name: row.name,
    attributes: row.attributes as ProductAttributes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
