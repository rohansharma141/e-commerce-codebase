import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type {
  TenantConfig,
  UpsertTenantConfigDto,
} from '@platform/modules/pricing/contracts';
import { TenantConfigService } from './tenant-config.service';

@ApiTags('Pricing (admin)')
@Controller('admin/tenant-config')
export class TenantConfigController {
  constructor(private readonly service: TenantConfigService) {}

  @Put()
  @ApiOperation({ summary: 'Set currency, tax rate (bps) and locale for this tenant' })
  upsert(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpsertTenantConfigDto,
  ): Promise<TenantConfig> {
    return this.service.upsert(tenant.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get this tenant\'s currency, tax and locale config' })
  get(@CurrentTenant() tenant: TenantContext): Promise<TenantConfig> {
    return this.service.get(tenant.tenantId);
  }
}
