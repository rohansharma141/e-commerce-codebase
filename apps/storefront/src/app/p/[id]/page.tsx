import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ProductDetailDocument } from '@platform/api-client';
import { getClient } from '@/lib/urql';

/**
 * Product detail page.
 *
 * Server-rendered: `id` from the URL drives a single GraphQL Query.product
 * call. A null result means the api couldn't find the product (or the
 * tenant's index doesn't have it) — we render the framework 404 so the
 * URL itself returns 404 to crawlers, not a 200 with empty content.
 *
 * Add-to-cart is a placeholder for now — the wiring lands in step 7d
 * along with CORS on the api and the client-rendered cart UI.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: PageProps) {
  // Server fetches happen inside the request scope already, so re-fetching
  // here for metadata isn't free — but it's the cleanest path to a tight
  // <title>. The api dedupes via http caching; perf cost is small.
  const result = await getClient().query(ProductDetailDocument, { id: params.id });
  const name = result.data?.product?.name;
  return name ? { title: name } : { title: 'Product' };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function formatCurrency(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export default async function ProductPage({ params }: PageProps) {
  const result = await getClient().query(ProductDetailDocument, { id: params.id });
  if (result.error) {
    throw new Error(`api error: ${result.error.message}`);
  }
  const product = result.data?.product;
  if (!product) {
    notFound();
  }

  const attrs = asRecord(product.attributes);
  const price = formatCurrency(attrs['price']);
  const brand = typeof attrs['brand'] === 'string' ? attrs['brand'] : null;
  const inStock = attrs['in_stock'] !== false;

  // Render every custom attribute the seed put on the product, except the
  // ones we surfaced explicitly (price, brand, in_stock).
  const featured = ['price', 'brand', 'in_stock'];
  const rest = Object.entries(attrs).filter(([k]) => !featured.includes(k));

  return (
    <main className="container mx-auto px-4 py-6">
      <nav className="mb-4 text-xs text-slate-500">
        <Link href="/" className="hover:text-slate-900">Home</Link>
        <span className="mx-1">/</span>
        <span className="text-slate-700">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_360px]">
        <div className="aspect-square rounded-lg bg-gradient-to-br from-slate-100 to-slate-200" aria-hidden="true">
          <div className="flex h-full items-center justify-center text-sm uppercase tracking-wider text-slate-400">
            {brand ?? 'no image'}
          </div>
        </div>

        <aside>
          <p className="text-sm text-slate-500">{product.sku}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{product.name}</h1>
          {brand ? (
            <p className="mt-2 text-sm text-slate-600">by {brand}</p>
          ) : null}

          <div className="mt-6 flex items-baseline gap-3">
            <span className="text-3xl font-semibold text-slate-900">{price}</span>
            <span className={inStock ? 'text-sm text-emerald-600' : 'text-sm text-rose-600'}>
              {inStock ? 'In stock' : 'Out of stock'}
            </span>
          </div>

          <AddToCartPlaceholder disabled={!inStock} />

          {rest.length > 0 ? (
            <dl className="mt-8 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-200 pt-6 text-sm">
              {rest.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-medium capitalize text-slate-500">{k.replace(/_/g, ' ')}</dt>
                  <dd className="text-slate-800">{renderAttr(v)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function renderAttr(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  return String(v);
}

function AddToCartPlaceholder({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      // Static for step 7c — the real cart integration lands in 7d (needs
      // CORS on the api and a client component for state).
      className="mt-6 w-full rounded-md bg-brand py-3 text-base font-semibold text-brand-fg shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      title="Cart UI lands in step 7d"
    >
      Add to cart
    </button>
  );
}
