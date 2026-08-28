import {
  Body,
  Controller,
  Delete,
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
  CreateProductDto,
  ListProductsResult,
  Product,
  UpdateProductDto,
} from '@platform/modules/catalog/contracts';
import { ProductListResponse } from '../catalog.schema';
import { ProductsService } from './products.service';

@ApiTags('Catalog (admin)')
@Controller('admin/products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create product (writes to catalog.products + indexes to OpenSearch)' })
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateProductDto,
  ): Promise<Product> {
    return this.service.create(tenant.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List products (by id, cursor-paginated)' })
  @ApiQuery({ name: 'limit', required: false, example: 50, description: 'Defaults to 50, max 100.' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque token from a previous response\'s nextCursor. Do not parse it.',
  })
  @ApiOkResponse({ type: ProductListResponse })
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ListProductsResult> {
    return this.service.list(tenant.tenantId, {
      limit: limit === undefined ? undefined : Number.parseInt(limit, 10),
      cursor,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by id' })
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Product> {
    return this.service.getById(tenant.tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update product fields (re-indexes into search)' })
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<Product> {
    return this.service.update(tenant.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete product' })
  delete(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    return this.service.delete(tenant.tenantId, id);
  }
}
