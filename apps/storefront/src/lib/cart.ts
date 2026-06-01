import 'server-only';
import { cookies } from 'next/headers';
import type { Cart, CartWithTotals, CreateCartResponse } from '@platform/api-client';
import { apiFetch } from './api-rest';

/**
 * Server-side cart helpers. Bridges the `cart_id` cookie to the api's cart
 * resource.
 *
 * Cookie strategy: a single `cart_id` cookie holds the cart UUID. NOT
 * HTTP-only — there's no secret in the cookie value; the api validates that
 * (a) the cart's tenant matches the request's tenant header, and (b) the
 * cart exists. We can flip it HTTP-only once we add a parallel browser-
 * readable cookie for the line count if needed.
 *
 * Tenant-scoped: cookie name is suffixed with the tenant id so switching
 * subdomains doesn't accidentally surface another tenant's cart id.
 */

const COOKIE_NAME_PREFIX = 'cart_id';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

function cookieName(tenantId: string): string {
  return `${COOKIE_NAME_PREFIX}_${tenantId}`;
}

export function readCartIdCookie(tenantId: string): string | null {
  return cookies().get(cookieName(tenantId))?.value ?? null;
}

export function writeCartIdCookie(tenantId: string, cartId: string): void {
  cookies().set(cookieName(tenantId), cartId, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  });
}

export function clearCartIdCookie(tenantId: string): void {
  cookies().delete(cookieName(tenantId));
}

/**
 * Returns the existing cart id, or creates a new cart on the api and
 * persists the id in the cookie.
 */
export async function ensureCartId(tenantId: string): Promise<string> {
  const existing = readCartIdCookie(tenantId);
  if (existing) return existing;
  const created = await apiFetch<CreateCartResponse>('/storefront/carts', {
    method: 'POST',
  });
  writeCartIdCookie(tenantId, created.cartId);
  return created.cartId;
}

/** Read the cart (with computed totals) if one exists. Null if no cookie. */
export async function getCart(tenantId: string): Promise<CartWithTotals | null> {
  const cartId = readCartIdCookie(tenantId);
  if (!cartId) return null;
  const cart = await apiFetch<CartWithTotals | null>(
    `/storefront/carts/${cartId}`,
    { throwOn404: false },
  );
  if (!cart) {
    // Cart cookie outlived its cart (Redis flushed, etc.). Drop stale cookie.
    clearCartIdCookie(tenantId);
  }
  return cart;
}

/** Just the lines + couponCode — used by the header cart count to avoid the totals round-trip when not needed. */
export type CartLite = Pick<Cart, 'id' | 'lines' | 'couponCode'>;
