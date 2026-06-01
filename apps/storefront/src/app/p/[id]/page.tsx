import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ProductDetailDocument } from '@platform/api-client';
import { graphqlQuery } from '@/lib/api-graphql';
import { getTenantId } from '@/lib/tenant';
import { AddToCartButton } from './add-to-cart-button';

/**
 * Product detail page.
 *
 * Cached per (tenantId, productId) via Next.js data cache with two tags:
 *   - `product:<tenantId>:<productId>` (narrow)
 *   - `browse:<tenantId>` (broad)
 *
 * The api's webhook dispatcher revalidates the narrow tag on
 * catalog.product.updated and the broad tag on created / deleted — so a
 * back-office edit reflects on the storefront within a webhook RTT, not
 * within the 1-hour fetch-cache fallback.
 *
 * Falling through to the framework 404 on a null product is important:
 * a deleted product's URL returns 404 to crawlers immediately after the
 * delete event revalidates this page.
 */

interface PageProps {
  params: { id: string };
}

async function fetchProductDetail(tenantId: string, id: string) {
  return graphqlQuery(
    ProductDetailDocument,
    { id },
    {
      tags: [`product:${tenantId}:${id}`, `browse:${tenantId}`],
    },
  );
}

export async function generateMetadata({ params }: PageProps) {
  // Server-side dedupe: the same fetch + tags + variables returns the
  // cached payload, so generateMetadata is free after the page render
  // populates the cache (and vice versa on cache-miss).
  const tenantId = getTenantId();
  const data = await fetchProductDetail(tenantId, params.id);
  const name = data.product?.name;
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
  const tenantId = getTenantId();
  const data = await fetchProductDetail(tenantId, params.id);
  const product = data.product;
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

          <AddToCartButton
            productId={product.id}
            sku={product.sku}
            name={product.name}
            disabled={!inStock}
          />

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

