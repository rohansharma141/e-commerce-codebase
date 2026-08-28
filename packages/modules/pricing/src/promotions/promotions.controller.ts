import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type {
  CreatePromotionDto,
  Promotion,
  UpdatePromotionDto,
} from '@platform/modules/pricing/contracts';
import { PromotionListResponse } from '../pricing.schema';
import { PromotionsService } from './promotions.service';

@ApiTags('Pricing (admin)')
@Controller('admin/promotions')
export class PromotionsController {
  constructor(private readonly service: PromotionsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a promotion (coupon-code or automatic)' })
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreatePromotionDto,
  ): Promise<Promotion> {
    return this.service.create(tenant.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List promotions (newest first, cursor-paginated)' })
  @ApiQuery({ name: 'limit', required: false, example: 50, description: 'Defaults to 50, max 100.' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque token from a previous response\'s nextCursor. Do not parse it.',
  })
  @ApiOkResponse({ type: PromotionListResponse })
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<PromotionListResponse> {
    return this.service.list(tenant.tenantId, {
      limit: limit === undefined ? undefined : Number.parseInt(limit, 10),
      cursor,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a promotion (e.g. deactivate)' })
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdatePromotionDto,
  ): Promise<Promotion> {
    return this.service.update(tenant.tenantId, id, dto);
  }
}
