import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type {
  CreatePromotionDto,
  Promotion,
  UpdatePromotionDto,
} from '@platform/modules/pricing/contracts';
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
  @ApiOperation({ summary: 'List promotions' })
  async list(@CurrentTenant() tenant: TenantContext): Promise<{ items: readonly Promotion[] }> {
    const items = await this.service.list(tenant.tenantId);
    return { items };
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
