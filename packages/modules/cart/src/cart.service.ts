import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TOTALS_SERVICE,
  type ITotalsService,
} from '@platform/modules/pricing/contracts';
import type {
  Cart,
  CartLine,
  CartWithTotals,
  ICartService,
} from '@platform/modules/cart/contracts';
import { CartRepository } from './cart.repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CartService implements ICartService {
  constructor(
    private readonly repo: CartRepository,
    @Inject(TOTALS_SERVICE) private readonly totals: ITotalsService,
  ) {}

  async create(tenantId: string): Promise<Cart> {
    return this.repo.create(tenantId, randomUUID());
  }

  async get(tenantId: string, cartId: string): Promise<CartWithTotals> {
    const cart = await this.requireCart(tenantId, cartId);
    const totals = await this.totals.compute({
      tenantId,
      lines: cart.lines,
      couponCode: cart.couponCode ?? undefined,
    });
    return { ...cart, totals };
  }

  async addItem(
    tenantId: string,
    cartId: string,
    item: { productId: string; sku: string; name: string; qty: number },
  ): Promise<Cart> {
    if (!UUID_RE.test(item.productId)) throw new BadRequestException('productId must be a UUID');
    if (!item.sku || typeof item.sku !== 'string') throw new BadRequestException('sku required');
    if (!item.name || typeof item.name !== 'string') throw new BadRequestException('name required');
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      throw new BadRequestException('qty must be a positive integer');
    }
    const cart = await this.requireCart(tenantId, cartId);
    const nextLines = mergeLine(cart.lines, item);
    return this.repo.save({ ...cart, lines: nextLines });
  }

  async setItemQty(tenantId: string, cartId: string, productId: string, qty: number): Promise<Cart> {
    if (!Number.isInteger(qty) || qty < 0) {
      throw new BadRequestException('qty must be a non-negative integer');
    }
    const cart = await this.requireCart(tenantId, cartId);
    if (qty > 0 && !cart.lines.some((l) => l.productId === productId)) {
      throw new NotFoundException(`product ${productId} not in cart`);
    }
    const nextLines =
      qty === 0
        ? cart.lines.filter((l) => l.productId !== productId)
        : cart.lines.map((l) => (l.productId === productId ? { ...l, qty } : l));
    return this.repo.save({ ...cart, lines: nextLines });
  }

  async applyCoupon(tenantId: string, cartId: string, code: string): Promise<Cart> {
    if (!code || typeof code !== 'string' || code.length > 64) {
      throw new BadRequestException('coupon code required, max 64 chars');
    }
    const cart = await this.requireCart(tenantId, cartId);
    return this.repo.save({ ...cart, couponCode: code });
  }

  async removeCoupon(tenantId: string, cartId: string): Promise<Cart> {
    const cart = await this.requireCart(tenantId, cartId);
    return this.repo.save({ ...cart, couponCode: null });
  }

  async deleteCart(tenantId: string, cartId: string): Promise<void> {
    await this.repo.delete(tenantId, cartId);
  }

  private async requireCart(tenantId: string, cartId: string): Promise<Cart> {
    if (!UUID_RE.test(cartId)) throw new BadRequestException('cartId must be a UUID');
    const cart = await this.repo.findById(tenantId, cartId);
    if (!cart) throw new NotFoundException('cart not found');
    return cart;
  }
}

function mergeLine(lines: readonly CartLine[], add: CartLine): CartLine[] {
  const idx = lines.findIndex((l) => l.productId === add.productId);
  if (idx === -1) return [...lines, add];
  const existing = lines[idx];
  if (!existing) return [...lines, add]; // appeases noUncheckedIndexedAccess
  // Re-add merges qty but keeps the EXISTING sku/name snapshot. Whether the
  // catalog has since renamed the product, the cart's view is stable across
  // its lifetime.
  return lines.map((l, i) =>
    i === idx
      ? {
          productId: existing.productId,
          sku: existing.sku,
          name: existing.name,
          qty: existing.qty + add.qty,
        }
      : l,
  );
}
