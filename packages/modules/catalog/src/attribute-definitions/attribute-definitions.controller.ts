import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type {
  AttributeDefinition,
  CreateAttributeDefinitionDto,
} from '@platform/modules/catalog/contracts';
import { AttributeDefinitionsService } from './attribute-definitions.service';

@ApiTags('Catalog (admin)')
@Controller('admin/attribute-definitions')
export class AttributeDefinitionsController {
  constructor(private readonly service: AttributeDefinitionsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Define a tenant-scoped typed attribute' })
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateAttributeDefinitionDto,
  ): Promise<AttributeDefinition> {
    return this.service.create(tenant.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List this tenant\'s attribute definitions' })
  async list(@CurrentTenant() tenant: TenantContext): Promise<{ items: readonly AttributeDefinition[] }> {
    const items = await this.service.list(tenant.tenantId);
    return { items };
  }
}
