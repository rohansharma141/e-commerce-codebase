import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type {
  AttributeDefinition,
  CreateAttributeDefinitionDto,
} from '@platform/modules/catalog/contracts';
import { AttributeDefinitionsService } from './attribute-definitions.service';

@Controller('admin/attribute-definitions')
export class AttributeDefinitionsController {
  constructor(private readonly service: AttributeDefinitionsService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateAttributeDefinitionDto,
  ): Promise<AttributeDefinition> {
    return this.service.create(tenant.tenantId, dto);
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<{ items: readonly AttributeDefinition[] }> {
    const items = await this.service.list(tenant.tenantId);
    return { items };
  }
}
