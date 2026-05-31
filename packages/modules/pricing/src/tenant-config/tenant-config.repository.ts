import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { TENANT_DRIZZLE, type TenantDrizzleAccessor } from '@platform/shared/database';
import type { TenantConfig } from '@platform/modules/pricing/contracts';
import { tenantConfig, type TenantConfigRow } from '../db/schema';

@Injectable()
export class TenantConfigRepository {
  constructor(@Inject(TENANT_DRIZZLE) private readonly accessor: TenantDrizzleAccessor) {}
  private get db() {
    return this.accessor.get();
  }

  async upsert(tenantId: string, currency: string, taxRateBps: number): Promise<TenantConfig> {
    const [row] = await this.db
      .insert(tenantConfig)
      .values({ tenantId, currency, taxRateBps, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: tenantConfig.tenantId,
        set: { currency, taxRateBps, updatedAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error('tenant_config upsert returned no row');
    return toDomain(row);
  }

  async findByTenant(tenantId: string): Promise<TenantConfig | null> {
    const rows = await this.db
      .select()
      .from(tenantConfig)
      .where(eq(tenantConfig.tenantId, tenantId))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }
}

function toDomain(row: TenantConfigRow): TenantConfig {
  return {
    tenantId: row.tenantId,
    currency: row.currency,
    taxRateBps: row.taxRateBps,
    updatedAt: row.updatedAt.toISOString(),
  };
}
