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
import type { Response } from 'express';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type { CheckoutDto, Order } from '@platform/modules/orders/contracts';
import { CheckoutService } from './checkout.service';
import { OrdersRepository } from './orders.repository';

@Controller()
export class OrdersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersRepository,
  ) {}

  @Post('storefront/checkout')
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
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query('limit') limit?: string,
  ): Promise<{ items: readonly Order[] }> {
    return this.orders.list(tenant.tenantId, {
      limit: limit ? Math.max(1, Number.parseInt(limit, 10) || 20) : 20,
    });
  }

  @Get('admin/orders/:id')
  @HttpCode(200)
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
