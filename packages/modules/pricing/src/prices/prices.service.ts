import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { EventBus } from '@platform/shared/event-bus';
import {
  PRICING_EVENTS,
  type Price,
  type UpsertPriceDto,
} from '@platform/modules/pricing/contracts';
import { PricesRepository } from './prices.repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PricesService {
  constructor(
    private readonly repo: PricesRepository,
    private readonly events: EventBus,
  ) {}

  async upsert(tenantId: string, dto: UpsertPriceDto): Promise<Price> {
    if (!dto?.productId || !UUID_RE.test(dto.productId)) {
      throw new BadRequestException('productId must be a UUID');
    }
    if (!Number.isInteger(dto.unitPriceCents) || dto.unitPriceCents < 0) {
      throw new BadRequestException('unitPriceCents must be a non-negative integer');
    }
    const price = await this.repo.upsert(tenantId, dto.productId, dto.unitPriceCents);

    // Published after the write commits, never before: a subscriber that
    // reads back the price must not be able to observe a value that isn't
    // durable yet.
    await this.events.publish({
      name: PRICING_EVENTS.PriceUpserted,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      payload: { price } as never,
    });

    return price;
  }

  async list(
    tenantId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: readonly Price[]; nextCursor: string | null }> {
    return this.repo.listPage(tenantId, opts);
  }
}
