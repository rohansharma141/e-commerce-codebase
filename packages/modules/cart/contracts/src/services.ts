import type { Cart, CartWithTotals } from './cart.dto';

/**
 * Cross-module contract for the cart service. Orders' checkout flow needs
 * cart.get and cart.delete to snapshot the cart and clear it on success.
 * Importing the concrete CartService from cart/src would violate the
 * type:src → type:src rule; injecting via this token is the supported path.
 */
export const CART_SERVICE = Symbol('CART_SERVICE');

export interface ICartService {
  get(tenantId: string, cartId: string): Promise<CartWithTotals>;
  deleteCart(tenantId: string, cartId: string): Promise<void>;

  // The cart's own controller calls these directly, not via this interface;
  // they are listed here for completeness so a future consumer (e.g. an
  // analytics module observing carts) can use the same token.
  create(tenantId: string): Promise<Cart>;
}
