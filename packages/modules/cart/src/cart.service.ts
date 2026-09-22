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
import {
  CHANNEL_QUERY,
  type ChannelConfig,
  type IChannelsQuery,
} from '@platform/modules/channels/contracts';
import { currentTenant } from '@platform/shared/tenant-context';
import { CartRepository } from './cart.repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CartService implements ICartService {
  constructor(
    private readonly repo: CartRepository,
    @Inject(TOTALS_SERVICE) private readonly totals: ITotalsService,
    /**
     * The event-fed read-model (C-14), via the token in `channels/contracts`.
     * Every cart operation consults it, so it must not be a database query;
     * the replica makes the common case a map lookup.
     */
    @Inject(CHANNEL_QUERY) private readonly channels: IChannelsQuery,
  ) {}

  /**
   * The channel the current request is operating in.
   *
   * The channel named on the request, or the tenant default when none was —
   * the absent-channel fallback ADR-0014 section 8 dates. An *unknown* channel
   * never reaches here: ChannelScopeMiddleware has already answered 404.
   */
  private async requestChannelId(tenantId: string): Promise<string> {
    return currentTenant()?.channelId ?? (await this.channels.findDefault(tenantId)).channelId;
  }

  /**
   * The resolved configuration of a channel id, or of the tenant default when
   * there is none — a request that named no channel, or a cart written before
   * carts carried one.
   *
   * A channel that no longer resolves is refused rather than replaced by the
   * default, for the reason checkout gives: pricing the basket somewhere else
   * would charge in a market nobody chose.
   */
  private async resolveChannel(
    tenantId: string,
    channelId: string | null | undefined,
  ): Promise<ChannelConfig> {
    if (!channelId) return this.channels.findDefault(tenantId);
    const channel = await this.channels.findById(tenantId, channelId);
    if (!channel) {
      throw new BadRequestException(
        `channel ${channelId} is no longer available for this tenant. Start a new cart ` +
          `in an active channel.`,
      );
    }
    return channel;
  }

  async create(tenantId: string): Promise<Cart> {
    const channel = await this.resolveChannel(tenantId, currentTenant()?.channelId);
    // Refused before anything is written: a basket in a channel the price list
    // cannot serve could never be priced, so it must not exist (C-32).
    await this.totals.assertServable(tenantId, channel);
    // The concrete id, even for the default. See Cart.channelId for why a cart
    // must not follow a later default promotion.
    return this.repo.create(tenantId, randomUUID(), channel.channelId);
  }

  async get(tenantId: string, cartId: string): Promise<CartWithTotals> {
    const cart = await this.requireCart(tenantId, cartId);
    // Priced in the cart's own channel. Checkout reaches the money path only
    // through here, so this is also what stops an order being charged in a
    // channel that became unservable after its cart was built.
    const channel = await this.resolveChannel(tenantId, cart.channelId);
    const totals = await this.totals.compute({
      tenantId,
      scope: channel,
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

  /**
   * Every path that loads a cart — read, add, requantify, coupon, and checkout
   * via `get` — comes through here, which is what makes the channel binding
   * impossible to skip by choosing a different operation.
   */
  private async requireCart(tenantId: string, cartId: string): Promise<Cart> {
    if (!UUID_RE.test(cartId)) throw new BadRequestException('cartId must be a UUID');
    const cart = await this.repo.findById(tenantId, cartId);
    if (!cart) throw new NotFoundException('cart not found');
    await this.assertSameChannel(tenantId, cart);
    return cart;
  }

  /**
   * Refuses to use a cart in a channel other than the one it was created in.
   *
   * **400, not 404.** Hiding the cart as not-found would follow the
   * cross-tenant precedent, but channels are deliberately *not* a trust
   * boundary (ADR-0014 section 1: RLS is keyed on tenant only). Pretending the
   * cart does not exist would imply one, and would make a client bug — dropping
   * the channel header mid-session — look like data loss.
   *
   * **400, not 409.** In this API a 409 means a version conflict and carries
   * `currentVersion` (ADMIN-API.md); a client that retries 409s would loop on a
   * mismatch that no retry can resolve.
   */
  private async assertSameChannel(tenantId: string, cart: Cart): Promise<void> {
    const requested = await this.requestChannelId(tenantId);
    const bound = cart.channelId ?? (await this.channels.findDefault(tenantId)).channelId;
    if (requested !== bound) {
      throw new BadRequestException({
        message:
          `cart ${cart.id} belongs to a different channel than this request. A cart is ` +
          `bound to the channel it was created in; start a new cart for this channel.`,
        error: 'Bad Request',
        statusCode: 400,
        cartChannelId: bound,
        requestChannelId: requested,
      });
    }
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
