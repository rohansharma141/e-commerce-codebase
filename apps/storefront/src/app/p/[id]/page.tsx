import { notFound } from 'next/navigation';
import { ProductDetailDocument } from '@platform/api-client';
import { graphqlQuery } from '@/lib/api-graphql';
import { browseTag } from '@/lib/cache-tags';
import { getTenantId } from '@/lib/tenant';
import { getMoneyFormat } from '@/lib/capabilities';
import { formatMajorUnits } from '@/lib/money';
import { Breadcrumbs, type Crumb } from '@/components/breadcrumbs';
import { RelatedProducts } from '@/components/related-products';
import { Badge } from '@/components/ui/badge';
import { AddToCartButton } from './add-to-cart-button';

/**
 * Product detail page.
 *
 * Cached per (tenantId, productId) via Next.js data cache with two tags:
 *   - `product:<tenantId>:<productId>` (narrow)
 *   - `browse:<tenantId>` (tenant-wide changes only, e.g. a promotion)
 *
 * A product event revalidates the narrow tag and the page path, so an edit
 * reflects on the storefront within a webhook RTT rather than within the
 * 1-hour fallback. It deliberately does NOT drop every other product's page:
 * that is what the category split in `@/lib/cache-tags` is for.
 */

interface PageProps {
  params: { id: string };
}

async function fetchProductDetail(tenantId: string, id: string) {
  return graphqlQuery(
    ProductDetailDocument,
    { id },
    {
      tags: [`product:${tenantId}:${id}`, browseTag(tenantId)],
    },
  );
}

export async function generateMetadata({ params }: PageProps) {
  const tenantId = getTenantId();
  const data = await fetchProductDetail(tenantId, params.id);
  const name = data.product?.name;
  return name ? { title: name } : { title: 'Product' };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export default async function ProductPage({ params }: PageProps) {
  const tenantId = getTenantId();
  const money = await getMoneyFormat();
  const data = await fetchProductDetail(tenantId, params.id);
  const product = data.product;
  if (!product) {
    notFound();
  }

  const attrs = asRecord(product.attributes);
  const price = formatMajorUnits(attrs['price'], money);
  const brand = typeof attrs['brand'] === 'string' ? attrs['brand'] : null;
  const category = typeof attrs['category'] === 'string' ? attrs['category'] : null;
  const inStock = attrs['in_stock'] !== false;

  // Surface every custom attribute except the ones promoted to the main column.
  const featured = ['price', 'brand', 'in_stock', 'category'];
  const rest = Object.entries(attrs).filter(([k]) => !featured.includes(k));

  // Breadcrumb trail. Category page exists at /c/[category] — link to it if present.
  const crumbs: Crumb[] = [{ label: 'Home', href: '/' }];
  if (category) crumbs.push({ label: category, href: `/c/${encodeURIComponent(category)}` });
  crumbs.push({ label: product.name });

  // Related-products pin: prefer category, fall back to brand. If neither, no rail.
  const relatedFilter = category
    ? { attribute: 'category', eq: category }
    : brand
      ? { attribute: 'brand', eq: brand }
      : undefined;

  return (
    <main className="container mx-auto px-4 py-6">
      <Breadcrumbs crumbs={crumbs} />

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_360px]">
        <div className="aspect-square rounded-lg bg-gradient-to-br from-slate-100 to-slate-200" aria-hidden="true">
          <div className="flex h-full items-center justify-center text-sm uppercase tracking-wider text-slate-400">
            {brand ?? 'no image'}
          </div>
        </div>

        <aside>
          <p className="text-sm text-slate-500">{product.sku}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{product.name}</h1>
          {brand ? <p className="mt-2 text-sm text-slate-600">by {brand}</p> : null}

          <div className="mt-6 flex items-baseline gap-3">
            <span className="text-3xl font-semibold text-slate-900">{price}</span>
            <Badge variant={inStock ? 'success' : 'danger'}>
              {inStock ? 'In stock' : 'Out of stock'}
            </Badge>
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

      <RelatedProducts excludeProductId={product.id} filter={relatedFilter} />
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
