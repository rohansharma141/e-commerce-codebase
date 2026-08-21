import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventBus } from '@platform/shared/event-bus';
import {
  PRICING_EVENTS,
  type ITenantConfigQuery,
  type TenantConfig,
  type UpsertTenantConfigDto,
} from '@platform/modules/pricing/contracts';
import { TenantConfigRepository } from './tenant-config.repository';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_TAX_BPS = 10_000; // 100%

@Injectable()
export class TenantConfigService implements ITenantConfigQuery {
  constructor(
    private readonly repo: TenantConfigRepository,
    private readonly events: EventBus,
  ) {}

  async upsert(tenantId: string, dto: UpsertTenantConfigDto): Promise<TenantConfig> {
    if (!CURRENCY_PATTERN.test(dto.currency)) {
      throw new BadRequestException('currency must be an uppercase ISO 4217 alpha-3 code');
    }
    if (!Number.isInteger(dto.taxRateBps) || dto.taxRateBps < 0 || dto.taxRateBps > MAX_TAX_BPS) {
      throw new BadRequestException(`taxRateBps must be an integer in [0, ${MAX_TAX_BPS}]`);
    }
    const config = await this.repo.upsert(tenantId, dto.currency, dto.taxRateBps);

    await this.events.publish({
      name: PRICING_EVENTS.TenantConfigUpdated,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      payload: { tenantId } as never,
    });

    return config;
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
