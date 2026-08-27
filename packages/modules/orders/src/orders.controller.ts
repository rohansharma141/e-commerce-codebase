import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
// Values, not types: `import type` erases the class and its @ApiProperty
// metadata with it, which puts the empty schemas straight back.
import { CheckoutDto, Order, OrderListResponse } from './orders.schema';
import { CheckoutService } from './checkout.service';
import { OrdersRepository } from './orders.repository';

@ApiTags('Orders')
@Controller()
export class OrdersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersRepository,
  ) {}

  @Post('storefront/checkout')
  @ApiOperation({
    summary: 'Checkout a cart — snapshots prices+promos into an immutable order',
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description: 'Optional UUID; replays return the same order with status 200',
  })
  @ApiCreatedResponse({ type: Order, description: 'A new order was created from the cart.' })
  @ApiOkResponse({
    type: Order,
    description:
      'The idempotency key had already been used. This is the order that key created, unchanged — not a second one.',
  })
  async checkoutEndpoint(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CheckoutDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Order> {
    const { order, createdNew } = await this.checkout.checkout(
      tenant.tenantId,
      dto.cartId,
      idempotencyKey,
    );
    res.status(createdNew ? HttpStatus.CREATED : HttpStatus.OK);
    return order;
  }

  @Get('admin/orders')
  @ApiOperation({ summary: 'List recent orders' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Defaults to 20.' })
  @ApiOkResponse({ type: OrderListResponse })
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query('limit') limit?: string,
  ): Promise<OrderListResponse> {
    return this.orders.list(tenant.tenantId, {
      limit: limit ? Math.max(1, Number.parseInt(limit, 10) || 20) : 20,
    });
  }

  @Get('admin/orders/:id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get order by id — grandTotalCents is the immutable snapshot from checkout',
  })
  @ApiOkResponse({ type: Order })
  @ApiNotFoundResponse({
    description:
      'No such order for this tenant. An order belonging to another tenant is invisible rather than forbidden, so it reports as not found.',
  })
  async get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Order> {
    const order = await this.orders.findById(tenant.tenantId, id);
    if (!order) {
      // Returning 404 — RLS already enforces invisibility for cross-tenant
      // queries; this branch fires for not-found and cross-tenant alike.
      throw new (await import('@nestjs/common')).NotFoundException(`order ${id} not found`);
    }
    return order;
  }
}
