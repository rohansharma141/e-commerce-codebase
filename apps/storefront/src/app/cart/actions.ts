'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Cart, Order } from '@platform/api-client';
import { apiFetch } from '@/lib/api-rest';
import {
  clearCartIdCookie,
  ensureCartId,
  readCartIdCookie,
} from '@/lib/cart';
import { getTenantId } from '@/lib/tenant';

/**
 * Server actions are the mutation surface for the storefront. They run on
 * the Next.js server, attach the tenant header to the api call, set/clear
 * cookies, and revalidate caches — all without exposing the api origin or
 * the tenant resolution mechanism to the browser.
 *
 * Each action that mutates the cart calls revalidatePath('/cart') so the
 * cart page (and any embedded cart count) re-fetches on the next render.
 */

interface AddToCartInput {
  productId: string;
  sku: string;
  name: string;
  qty?: number;
}

export async function addToCart(input: AddToCartInput): Promise<void> {
  const tenantId = getTenantId();
  const cartId = await ensureCartId(tenantId);
  await apiFetch<Cart>(`/storefront/carts/${cartId}/items`, {
    method: 'POST',
    body: {
      productId: input.productId,
      sku: input.sku,
      name: input.name,
      qty: input.qty ?? 1,
    },
  });
  revalidatePath('/cart');
  revalidatePath('/', 'layout'); // re-renders the header cart count
}

export async function setLineQty(productId: string, qty: number): Promise<void> {
  const tenantId = getTenantId();
  const cartId = readCartIdCookie(tenantId);
  if (!cartId) return;
  await apiFetch<Cart>(`/storefront/carts/${cartId}/items/${productId}`, {
    method: 'PATCH',
    body: { qty },
  });
  revalidatePath('/cart');
  revalidatePath('/', 'layout');
}

export async function applyCoupon(code: string): Promise<{ ok: boolean; error?: string }> {
  const tenantId = getTenantId();
  const cartId = await ensureCartId(tenantId);
  try {
    await apiFetch<Cart>(`/storefront/carts/${cartId}/coupon`, {
      method: 'POST',
      body: { code },
    });
    revalidatePath('/cart');
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid coupon';
    return { ok: false, error: message };
  }
}

export async function removeCoupon(): Promise<void> {
  const tenantId = getTenantId();
  const cartId = readCartIdCookie(tenantId);
  if (!cartId) return;
  await apiFetch<Cart>(`/storefront/carts/${cartId}/coupon`, { method: 'DELETE' });
  revalidatePath('/cart');
}

/**
 * Checkout: POST /storefront/checkout with a fresh idempotency key, drop the
 * cart cookie on success, redirect to the order confirmation page.
 *
 * A fresh key per submission means a double-click creates two orders. The
 * checkout button uses React's useTransition pending state to gate that on
 * the client; the api's idempotency table is the second line of defence.
 */
export async function checkout(): Promise<never> {
  const tenantId = getTenantId();
  const cartId = readCartIdCookie(tenantId);
  if (!cartId) {
    throw new Error('cart is empty');
  }
  const idempotencyKey = randomUUID();
  const order = await apiFetch<Order>('/storefront/checkout', {
    method: 'POST',
    body: { cartId },
    headers: { 'idempotency-key': idempotencyKey },
  });
  clearCartIdCookie(tenantId);
  revalidatePath('/', 'layout');
  redirect(`/orders/${order.id}`);
}
