import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import {
  TENANT_DRIZZLE,
  clampLimit,
  decodeCursor,
  toPage,
  type TenantDrizzleAccessor,
} from '@platform/shared/database';
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
  constructor(@Inject(TENANT_DRIZZLE) private readonly dbAccessor: TenantDrizzleAccessor) {}

  // See AttributeDefinitionsRepository for the rationale on TENANT_DRIZZLE +
  // defense-in-depth WHEREs. Same pattern.
  private get db() {
    return this.dbAccessor.get();
  }

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

  /**
   * Paged by an opaque keyset cursor on `id`.
   *
   * This endpoint had working cursor pagination before C-1 and was the shape
   * the other four adopted. What changed here is only the token encoding: it
   * used to return the last row's raw uuid, and now returns the same value
   * through the shared codec, so all five admin lists issue interchangeable,
   * opaque tokens. The request and response field names are untouched.
   */
  async list(
    tenantId: string,
    opts: { limit?: number; cursor?: string },
  ): Promise<{ items: readonly Product[]; nextCursor: string | null }> {
    const cap = clampLimit(opts.limit);
    const keyset = opts.cursor ? decodeCursor(opts.cursor, 1) : undefined;
    const where = keyset
      ? and(eq(products.tenantId, tenantId), gt(products.id, keyset[0] as string))
      : eq(products.tenantId, tenantId);

    const rows = await this.db
      .select()
      .from(products)
      .where(where)
      .orderBy(asc(products.id))
      .limit(cap + 1);

    const page = toPage(rows, cap, (row) => [row.id]);
    return { items: page.items.map(toDomain), nextCursor: page.nextCursor };
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
