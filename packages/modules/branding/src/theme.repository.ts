import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { TENANT_DRIZZLE, type TenantDrizzleAccessor } from '@platform/shared/database';
import type { StorefrontTheme } from '@platform/modules/branding/contracts';
import { theme as themeTable } from './db/schema';

/**
 * Reads and writes `branding.theme`.
 *
 * Every query runs on the request's tenant-bound connection, so RLS scopes it
 * without a WHERE clause on tenant_id. The explicit `eq` is still there as
 * belt-and-braces — the same posture every other repository in the platform
 * takes, because a WHERE clause is cheap and a missing policy is not.
 */
@Injectable()
export class ThemeRepository {
  constructor(@Inject(TENANT_DRIZZLE) private readonly accessor: TenantDrizzleAccessor) {}

  private get db() {
    return this.accessor.get();
  }

  /**
   * Returns whatever the tenant has set, which may be partial or absent. The
   * resolver layers it over DEFAULT_THEME, so a tenant that has configured
   * nothing still renders — an api-only customer never has to populate this.
   */
  async findByTenant(tenantId: string): Promise<Partial<StorefrontTheme> | null> {
    const rows = await this.db
      .select({ theme: themeTable.theme })
      .from(themeTable)
      .where(eq(themeTable.tenantId, tenantId))
      .limit(1);
    const found = rows[0]?.theme;
    if (!found || typeof found !== 'object') return null;
    return found as Partial<StorefrontTheme>;
  }

  async upsert(tenantId: string, value: Partial<StorefrontTheme>): Promise<void> {
    await this.db
      .insert(themeTable)
      .values({ tenantId, theme: value as Record<string, unknown> })
      .onConflictDoUpdate({
        target: themeTable.tenantId,
        set: { theme: value as Record<string, unknown>, updatedAt: sql`now()` },
      });
  }
}
