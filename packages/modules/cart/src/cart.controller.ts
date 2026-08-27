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
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
// Imported as values, not types. `@ApiProperty` metadata only reaches the
// OpenAPI document if the class survives to runtime, and a `import type` here
// would erase it — leaving the operations documented with empty bodies again,
// which is the state this replaced.
import {
  AddItemDto,
  ApplyCouponDto,
  Cart,
  CartWithTotals,
  CreateCartResponse,
  SetItemQtyDto,
} from './cart.schema';
import { CartService } from './cart.service';

@ApiTags('Cart (storefront)')
@Controller('storefront/carts')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an empty cart' })
  @ApiCreatedResponse({ type: CreateCartResponse })
  async create(@CurrentTenant() tenant: TenantContext): Promise<CreateCartResponse> {
    const c = await this.cart.create(tenant.tenantId);
    return { cartId: c.id };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get cart by id with live totals' })
  @ApiOkResponse({ type: CartWithTotals })
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<CartWithTotals> {
    return this.cart.get(tenant.tenantId, id);
  }

  @Post(':id/items')
  @ApiOperation({ summary: 'Add a product line to the cart' })
  @ApiCreatedResponse({ type: Cart })
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
  @ApiOkResponse({ type: Cart })
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
  @ApiCreatedResponse({ type: Cart })
  applyCoupon(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ApplyCouponDto,
  ): Promise<Cart> {
    return this.cart.applyCoupon(tenant.tenantId, id, dto.code);
  }

  @Delete(':id/coupon')
  @ApiOperation({ summary: 'Remove the applied coupon code' })
  @ApiOkResponse({ type: Cart })
  removeCoupon(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Cart> {
    return this.cart.removeCoupon(tenant.tenantId, id);
  }
}
