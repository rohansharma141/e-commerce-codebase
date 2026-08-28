import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type { Price, UpsertPriceDto } from '@platform/modules/pricing/contracts';
import { PriceListResponse } from '../pricing.schema';
import { PricesService } from './prices.service';

@ApiTags('Pricing (admin)')
@Controller('admin/prices')
export class PricesController {
  constructor(private readonly service: PricesService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Upsert unit price for a product (in cents)' })
  upsert(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpsertPriceDto,
  ): Promise<Price> {
    return this.service.upsert(tenant.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List prices (ordered by productId, cursor-paginated)' })
  @ApiQuery({ name: 'limit', required: false, example: 50, description: 'Defaults to 50, max 100.' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque token from a previous response\'s nextCursor. Do not parse it.',
  })
  @ApiOkResponse({ type: PriceListResponse })
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<PriceListResponse> {
    return this.service.list(tenant.tenantId, {
      limit: limit === undefined ? undefined : Number.parseInt(limit, 10),
      cursor,
    });
  }
}
