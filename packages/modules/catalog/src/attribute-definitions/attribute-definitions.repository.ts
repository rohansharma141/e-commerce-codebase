import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import {
  TENANT_DRIZZLE,
  clampLimit,
  decodeCursor,
  toPage,
  type TenantDrizzleAccessor,
} from '@platform/shared/database';
import type {
  AttributeDefinition,
  AttributeType,
} from '@platform/modules/catalog/contracts';
import { attributeDefinitions, type AttributeDefinitionRow } from '../db/schema';

export interface NewAttributeDefinition {
  readonly tenantId: string;
  readonly code: string;
  readonly type: AttributeType;
  readonly multiValue: boolean;
  readonly config: Record<string, unknown>;
}

@Injectable()
export class AttributeDefinitionsRepository {
  constructor(@Inject(TENANT_DRIZZLE) private readonly dbAccessor: TenantDrizzleAccessor) {}

  // Repo grabs the request-scoped Drizzle client at query time. The connection
  // it returns has app.tenant_id pinned, so RLS does the enforcement; the
  // explicit WHERE clauses below are kept for defense-in-depth.
  private get db() {
    return this.dbAccessor.get();
  }

  async insert(input: NewAttributeDefinition): Promise<AttributeDefinition> {
    const [row] = await this.db
      .insert(attributeDefinitions)
      .values({
        tenantId: input.tenantId,
        code: input.code,
        type: input.type,
        multiValue: input.multiValue,
        config: input.config,
      })
      .returning();
    if (!row) throw new Error('attribute_definitions insert returned no row');
    return toDomain(row);
  }

  /**
   * Every definition for the tenant, unpaginated.
   *
   * Deliberately left that way: `attribute-validator.ts` calls this to validate
   * a product's attributes against the full set. Paginating it in place would
   * make the validator silently stop checking anything past the first page —
   * a validation hole that no test would have reported, because the products
   * it wrongly accepted would look perfectly valid.
   */
  async listByTenant(tenantId: string): Promise<readonly AttributeDefinition[]> {
    const rows = await this.db
      .select()
      .from(attributeDefinitions)
      .where(eq(attributeDefinitions.tenantId, tenantId));
    return rows.map(toDomain);
  }

  /**
   * The admin list: alphabetical by `code`, paged by an opaque keyset cursor.
   *
   * `code` rather than `id` because `attribute_definitions_tenant_code_unique`
   * makes it a total order within a tenant, and because an operator scanning a
   * list of attributes wants them alphabetical, not in random UUID order.
   */
  async listPage(
    tenantId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: readonly AttributeDefinition[]; nextCursor: string | null }> {
    const cap = clampLimit(opts.limit);
    const keyset = opts.cursor ? decodeCursor(opts.cursor, 1) : undefined;
    const where = keyset
      ? and(
          eq(attributeDefinitions.tenantId, tenantId),
          gt(attributeDefinitions.code, keyset[0] as string),
        )
      : eq(attributeDefinitions.tenantId, tenantId);

    const rows = await this.db
      .select()
      .from(attributeDefinitions)
      .where(where)
      .orderBy(asc(attributeDefinitions.code))
      .limit(cap + 1);

    const page = toPage(rows, cap, (row) => [row.code]);
    return { items: page.items.map(toDomain), nextCursor: page.nextCursor };
  }

  async findByCode(tenantId: string, code: string): Promise<AttributeDefinition | null> {
    const rows = await this.db
      .select()
      .from(attributeDefinitions)
      .where(and(eq(attributeDefinitions.tenantId, tenantId), eq(attributeDefinitions.code, code)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }
}

function toDomain(row: AttributeDefinitionRow): AttributeDefinition {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    type: row.type as AttributeType,
    multiValue: row.multiValue,
    config: row.config as AttributeDefinition['config'],
    createdAt: row.createdAt.toISOString(),
  };
}
