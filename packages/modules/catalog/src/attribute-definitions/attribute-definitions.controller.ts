import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type {
  AttributeDefinition,
  CreateAttributeDefinitionDto,
} from '@platform/modules/catalog/contracts';
import { AttributeDefinitionListResponse } from '../catalog.schema';
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
  @ApiOperation({
    summary: 'List this tenant\'s attribute definitions (by code, cursor-paginated)',
  })
  @ApiQuery({ name: 'limit', required: false, example: 50, description: 'Defaults to 50, max 100.' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque token from a previous response\'s nextCursor. Do not parse it.',
  })
  @ApiOkResponse({ type: AttributeDefinitionListResponse })
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<AttributeDefinitionListResponse> {
    return this.service.list(tenant.tenantId, {
      limit: limit === undefined ? undefined : Number.parseInt(limit, 10),
      cursor,
    });
  }
}
