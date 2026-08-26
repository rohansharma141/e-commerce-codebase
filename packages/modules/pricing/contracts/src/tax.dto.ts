import type { Bps } from './money';

export interface TenantConfig {
  readonly tenantId: string;
  readonly currency: string;
  readonly taxRateBps: Bps;
  /** BCP-47 tag, e.g. `en-US` or `de-DE`. Drives money formatting. */
  readonly locale: string;
  readonly updatedAt: string;
}

export interface UpsertTenantConfigDto {
  readonly currency: string;
  readonly taxRateBps: Bps;
  /**
   * Optional: omitting it leaves the tenant's current locale alone, so a
   * caller updating only a tax rate cannot silently reset formatting.
   */
  readonly locale?: string;
}
