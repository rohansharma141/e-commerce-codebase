import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleClient } from '@platform/shared/database';
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
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleClient) {}

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

  async listByTenant(tenantId: string): Promise<readonly AttributeDefinition[]> {
    const rows = await this.db
      .select()
      .from(attributeDefinitions)
      .where(eq(attributeDefinitions.tenantId, tenantId));
    return rows.map(toDomain);
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
