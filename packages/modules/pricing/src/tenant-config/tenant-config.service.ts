import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ITenantConfigQuery,
  TenantConfig,
  UpsertTenantConfigDto,
} from '@platform/modules/pricing/contracts';
import { TenantConfigRepository } from './tenant-config.repository';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_TAX_BPS = 10_000; // 100%

@Injectable()
export class TenantConfigService implements ITenantConfigQuery {
  constructor(private readonly repo: TenantConfigRepository) {}

  async upsert(tenantId: string, dto: UpsertTenantConfigDto): Promise<TenantConfig> {
    if (!CURRENCY_PATTERN.test(dto.currency)) {
      throw new BadRequestException('currency must be an uppercase ISO 4217 alpha-3 code');
    }
    if (!Number.isInteger(dto.taxRateBps) || dto.taxRateBps < 0 || dto.taxRateBps > MAX_TAX_BPS) {
      throw new BadRequestException(`taxRateBps must be an integer in [0, ${MAX_TAX_BPS}]`);
    }
    return this.repo.upsert(tenantId, dto.currency, dto.taxRateBps);
  }

  async get(tenantId: string): Promise<TenantConfig> {
    const row = await this.repo.findByTenant(tenantId);
    if (!row) throw new NotFoundException('tenant_config not set for this tenant');
    return row;
  }

  /** Used by totals-service; returns null instead of throwing for the "not configured yet" path. */
  async findOptional(tenantId: string): Promise<TenantConfig | null> {
    return this.repo.findByTenant(tenantId);
  }
}
