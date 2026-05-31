import { Body, Controller, Get, Put } from '@nestjs/common';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type {
  TenantConfig,
  UpsertTenantConfigDto,
} from '@platform/modules/pricing/contracts';
import { TenantConfigService } from './tenant-config.service';

@Controller('admin/tenant-config')
export class TenantConfigController {
  constructor(private readonly service: TenantConfigService) {}

  @Put()
  upsert(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpsertTenantConfigDto,
  ): Promise<TenantConfig> {
    return this.service.upsert(tenant.tenantId, dto);
  }

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<TenantConfig> {
    return this.service.get(tenant.tenantId);
  }
}
