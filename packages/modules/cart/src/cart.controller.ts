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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type {
  AddItemDto,
  ApplyCouponDto,
  Cart,
  CartWithTotals,
  CreateCartResponse,
  SetItemQtyDto,
} from '@platform/modules/cart/contracts';
import { CartService } from './cart.service';

@ApiTags('Cart (storefront)')
@Controller('storefront/carts')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an empty cart' })
  async create(@CurrentTenant() tenant: TenantContext): Promise<CreateCartResponse> {
    const c = await this.cart.create(tenant.tenantId);
    return { cartId: c.id };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get cart by id with live totals' })
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<CartWithTotals> {
    return this.cart.get(tenant.tenantId, id);
  }

  @Post(':id/items')
  @ApiOperation({ summary: 'Add a product line to the cart' })
  addItem(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AddItemDto,
  ): Promise<Cart> {
    return this.cart.addItem(tenant.tenantId, id, {
      productId: dto.productId,
      sku: dto.sku,
      name: dto.name,
      qty: dto.qty,
    });
  }

  @Patch(':id/items/:productId')
  @ApiOperation({ summary: 'Change line quantity — qty=0 removes the line' })
  setItemQty(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: SetItemQtyDto,
  ): Promise<Cart> {
    return this.cart.setItemQty(tenant.tenantId, id, productId, dto.qty);
  }

  @Post(':id/coupon')
  @ApiOperation({ summary: 'Apply a coupon code to the cart' })
  applyCoupon(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ApplyCouponDto,
  ): Promise<Cart> {
    return this.cart.applyCoupon(tenant.tenantId, id, dto.code);
  }

  @Delete(':id/coupon')
  @ApiOperation({ summary: 'Remove the applied coupon code' })
  removeCoupon(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Cart> {
    return this.cart.removeCoupon(tenant.tenantId, id);
  }
}
