import { Inject, Injectable } from '@nestjs/common';
import { TENANT_REDIS, type TenantRedisClient } from '@platform/shared/redis';
import type { Cart, CartLine } from '@platform/modules/cart/contracts';

const TTL_SECONDS = 60 * 60 * 24; // 24h

interface StoredCart {
  id: string;
  tenantId: string;
  lines: CartLine[];
  couponCode: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CartRepository {
  constructor(@Inject(TENANT_REDIS) private readonly tenantRedis: TenantRedisClient) {}

  private key(cartId: string): string {
    return `cart:${cartId}`;
  }

  async create(tenantId: string, cartId: string): Promise<Cart> {
    const now = new Date().toISOString();
    const cart: StoredCart = {
      id: cartId,
      tenantId,
      lines: [],
      couponCode: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.tenantRedis.forTenant(tenantId).set(this.key(cartId), JSON.stringify(cart), TTL_SECONDS);
    return cart;
  }

  async findById(tenantId: string, cartId: string): Promise<Cart | null> {
    const raw = await this.tenantRedis.forTenant(tenantId).get(this.key(cartId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCart;
    if (parsed.tenantId !== tenantId) {
      // Defense-in-depth: the key is already namespaced by tenant, but if
      // for any reason a cart ended up under the wrong namespace, refuse
      // to return cross-tenant data.
      return null;
    }
    return parsed;
  }

  async save(cart: Cart): Promise<Cart> {
    const updated: StoredCart = {
      id: cart.id,
      tenantId: cart.tenantId,
      lines: cart.lines.map((l) => ({
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        qty: l.qty,
      })),
      couponCode: cart.couponCode,
      createdAt: cart.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.tenantRedis
      .forTenant(cart.tenantId)
      .set(this.key(cart.id), JSON.stringify(updated), TTL_SECONDS);
    return updated;
  }

  async delete(tenantId: string, cartId: string): Promise<void> {
    await this.tenantRedis.forTenant(tenantId).del(this.key(cartId));
  }
}
