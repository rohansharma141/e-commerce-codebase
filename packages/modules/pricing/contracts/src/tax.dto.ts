import type { Bps } from './money';

export interface TenantConfig {
  readonly tenantId: string;
  readonly currency: string;
  readonly taxRateBps: Bps;
  readonly updatedAt: string;
}

export interface UpsertTenantConfigDto {
  readonly currency: string;
  readonly taxRateBps: Bps;
}
