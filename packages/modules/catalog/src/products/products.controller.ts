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
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type {
  CreateProductDto,
  ListProductsResult,
  Product,
  UpdateProductDto,
} from '@platform/modules/catalog/contracts';
import { ProductsService } from './products.service';

@Controller('admin/products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateProductDto,
  ): Promise<Product> {
    return this.service.create(tenant.tenantId, dto);
  }

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ListProductsResult> {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.service.list(tenant.tenantId, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      cursor,
    });
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Product> {
    return this.service.getById(tenant.tenantId, id);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<Product> {
    return this.service.update(tenant.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    return this.service.delete(tenant.tenantId, id);
  }
}
