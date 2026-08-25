import Link from 'next/link';
import { getCart } from '@/lib/cart';
import { getTenantId } from '@/lib/tenant';
import { getMoneyFormat } from '@/lib/capabilities';
import { CartView } from './cart-view';

/**
 * Cart page. Server fetches the cart (via cookie) — the client component
 * gets the resolved snapshot. Mutations flow through the server actions in
 * ./actions.ts, each of which revalidates this path so the next render
 * reflects the api's truth.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cart',
  robots: { index: false, follow: false }, // personal page, no SEO
};

export default async function CartPage() {
  const tenantId = getTenantId();
  const cart = await getCart(tenantId);
  const money = await getMoneyFormat();

  if (!cart || cart.lines.length === 0) {
    return (
      <main className="container mx-auto px-4 py-10">
        <h1 className="mb-6 text-2xl font-bold tracking-tight md:text-3xl">Your cart</h1>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-base font-medium text-slate-700">Your cart is empty.</p>
          <p className="mt-1 text-sm text-slate-500">
            Find something to buy and we&apos;ll keep it here.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:opacity-90"
          >
            Browse the catalog
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold tracking-tight md:text-3xl">Your cart</h1>
      <CartView cart={cart} money={money} />
    </main>
  );
}
