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

  /**
   * `locale` is optional all the way down: undefined means "leave it alone".
   * On insert the column default applies; on conflict the key is simply
   * absent from the SET, so a caller changing only the tax rate cannot reset
   * a tenant's formatting as a side effect.
   */
  async upsert(
    tenantId: string,
    currency: string,
    taxRateBps: number,
    locale?: string,
  ): Promise<TenantConfig> {
    const [row] = await this.db
      .insert(tenantConfig)
      .values({
        tenantId,
        currency,
        taxRateBps,
        ...(locale ? { locale } : {}),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tenantConfig.tenantId,
        set: { currency, taxRateBps, ...(locale ? { locale } : {}), updatedAt: sql`now()` },
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
    locale: row.locale,
    updatedAt: row.updatedAt.toISOString(),
  };
}
