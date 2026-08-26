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

/**
 * Validate against Intl rather than a regex.
 *
 * BCP-47 is far too irregular to pattern-match honestly — `de-DE`, `zh-Hant-TW`
 * and `en-US-u-ca-gregory` are all valid, and any regex short enough to read
 * rejects some of them. More to the point, `Intl.NumberFormat` is what
 * actually consumes this tag downstream, so accepting exactly what Intl
 * accepts makes the stored value and the thing that uses it agree by
 * construction. A tag that passes here cannot blow up in a formatter later.
 */
function assertValidLocale(locale: string): void {
  try {
    const [canonical] = Intl.getCanonicalLocales(locale);
    if (!canonical) throw new RangeError('empty');
  } catch {
    throw new BadRequestException(
      `locale must be a valid BCP-47 language tag (e.g. en-US, de-DE); got "${locale}"`,
    );
  }
}

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
    if (dto.locale !== undefined) {
      assertValidLocale(dto.locale);
    }
    const config = await this.repo.upsert(tenantId, dto.currency, dto.taxRateBps, dto.locale);

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
