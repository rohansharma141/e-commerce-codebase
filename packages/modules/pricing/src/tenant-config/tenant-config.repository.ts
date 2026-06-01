import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { TENANT_DRIZZLE, type TenantDrizzleAccessor } from '@platform/shared/database';
import type { StorefrontTheme, TenantConfig } from '@platform/modules/pricing/contracts';
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

  /**
   * Reads the raw `theme` JSONB column. Returns null when there's no row for
   * the tenant OR the column is null — callers layer DEFAULT_THEME on top.
   * Kept separate from `findByTenant` because theme is conceptually a
   * branding concern that happens to ride on the pricing config row; a
   * future branding module would move this method without touching
   * `TenantConfig`.
   */
  async findThemeByTenant(tenantId: string): Promise<Partial<StorefrontTheme> | null> {
    const rows = await this.db
      .select({ theme: tenantConfig.theme })
      .from(tenantConfig)
      .where(eq(tenantConfig.tenantId, tenantId))
      .limit(1);
    const theme = rows[0]?.theme;
    if (!theme || typeof theme !== 'object') return null;
    return theme as Partial<StorefrontTheme>;
  }

  /**
   * Upsert just the theme blob. Used by the seed and by the (future) admin
   * branding endpoint. Touches updated_at so the storefront's cache can be
   * invalidated by a value-based check when we wire `tenant.config.updated`
   * into the webhook dispatcher.
   */
  async upsertTheme(tenantId: string, theme: Partial<StorefrontTheme>): Promise<void> {
    await this.db
      .insert(tenantConfig)
      .values({
        tenantId,
        currency: 'USD',
        taxRateBps: 0,
        theme: theme as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tenantConfig.tenantId,
        set: { theme: theme as Record<string, unknown>, updatedAt: sql`now()` },
      });
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
