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

@Controller('storefront/carts')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentTenant() tenant: TenantContext): Promise<CreateCartResponse> {
    const c = await this.cart.create(tenant.tenantId);
    return { cartId: c.id };
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<CartWithTotals> {
    return this.cart.get(tenant.tenantId, id);
  }

  @Post(':id/items')
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
  setItemQty(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: SetItemQtyDto,
  ): Promise<Cart> {
    return this.cart.setItemQty(tenant.tenantId, id, productId, dto.qty);
  }

  @Post(':id/coupon')
  applyCoupon(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ApplyCouponDto,
  ): Promise<Cart> {
    return this.cart.applyCoupon(tenant.tenantId, id, dto.code);
  }

  @Delete(':id/coupon')
  removeCoupon(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Cart> {
    return this.cart.removeCoupon(tenant.tenantId, id);
  }
}
