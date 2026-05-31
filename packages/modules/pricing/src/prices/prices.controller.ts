import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type { Price, UpsertPriceDto } from '@platform/modules/pricing/contracts';
import { PricesService } from './prices.service';

@Controller('admin/prices')
export class PricesController {
  constructor(private readonly service: PricesService) {}

  @Post()
  @HttpCode(201)
  upsert(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpsertPriceDto,
  ): Promise<Price> {
    return this.service.upsert(tenant.tenantId, dto);
  }

  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query('limit') limit?: string,
  ): Promise<{ items: readonly Price[] }> {
    const items = await this.service.list(
      tenant.tenantId,
      limit ? Number.parseInt(limit, 10) : undefined,
    );
    return { items };
  }
}
