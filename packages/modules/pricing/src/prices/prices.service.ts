import { BadRequestException, Injectable } from '@nestjs/common';
import type { Price, UpsertPriceDto } from '@platform/modules/pricing/contracts';
import { PricesRepository } from './prices.repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PricesService {
  constructor(private readonly repo: PricesRepository) {}

  async upsert(tenantId: string, dto: UpsertPriceDto): Promise<Price> {
    if (!dto?.productId || !UUID_RE.test(dto.productId)) {
      throw new BadRequestException('productId must be a UUID');
    }
    if (!Number.isInteger(dto.unitPriceCents) || dto.unitPriceCents < 0) {
      throw new BadRequestException('unitPriceCents must be a non-negative integer');
    }
    return this.repo.upsert(tenantId, dto.productId, dto.unitPriceCents);
  }

  async list(tenantId: string, limit?: number): Promise<readonly Price[]> {
    return this.repo.findByTenant(tenantId, limit ?? 50);
  }
}
