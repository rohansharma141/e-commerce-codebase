import { Inject, Injectable } from '@nestjs/common';
import { TENANT_REDIS, type TenantRedisClient } from '@platform/shared/redis';
import type { Cart, CartLine } from '@platform/modules/cart/contracts';

/**
 * What `JSON.parse` actually returns: a cart written before C-16b has no
 * `channelId` key at all. Kept as a separate type so the normalisation below is
 * something the compiler checks, rather than an assignment that happens to run.
 */
type ParsedCart = Omit<StoredCart, 'channelId'> & { channelId?: string | null };

const TTL_SECONDS = 60 * 60 * 24; // 24h

interface StoredCart {
  id: string;
  tenantId: string;
  /** Always written since C-16b. See `ParsedCart` for what comes back. */
  channelId: string | null;
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

  async create(tenantId: string, cartId: string, channelId: string): Promise<Cart> {
    const now = new Date().toISOString();
    const cart: StoredCart = {
      id: cartId,
      tenantId,
      channelId,
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
    const stored = JSON.parse(raw) as ParsedCart;
    // Normalise the pre-C-16b shape: a missing key and an explicit null mean
    // the same thing, and the contract promises `string | null`, never
    // `undefined` -- the storefront's pinned key list would otherwise see the
    // field appear and disappear depending on the cart's age.
    const parsed: StoredCart = { ...stored, channelId: stored.channelId ?? null };
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
      // Carried through every save. Dropping it here would silently unbind a
      // cart on its first mutation, which is the one moment binding matters.
      channelId: cart.channelId,
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
