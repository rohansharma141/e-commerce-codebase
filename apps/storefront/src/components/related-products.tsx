import Link from 'next/link';
import { CatalogSearchDocument } from '@platform/api-client';
import { graphqlQuery } from '@/lib/api-graphql';
import { getTenantId } from '@/lib/tenant';
import { ProductCard } from './product-card';

interface RelatedProductsProps {
  excludeProductId: string;
  /** Pinning attribute (brand / category) — drives what "related" means. */
  filter?: { attribute: string; eq: string };
}

/**
 * "Related products" rail on the PDP. Reuses Query.search with one filter
 * (typically brand or category) and trims out the current product.
 * Returns null if nothing relevant came back so the PDP layout doesn't
 * carry an empty section.
 */
export async function RelatedProducts({ excludeProductId, filter }: RelatedProductsProps) {
  if (!filter) return null;
  const tenantId = getTenantId();
  const data = await graphqlQuery(
    CatalogSearchDocument,
    {
      input: {
        filters: [filter],
        limit: 8,
        facets: [],
      },
    },
    { tags: [`browse:${tenantId}`] },
  );
  const items = data.search.items.filter((p) => p.id !== excludeProductId).slice(0, 6);
  if (items.length === 0) return null;

  return (
    <section className="mt-16">
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight">More like this</h2>
        <span className="text-xs opacity-50 capitalize">{filter.attribute}: {filter.eq}</span>
      </header>
      <ul
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6"
        role="list"
      >
        {items.map((p) => (
          <li key={p.id}>
            <Link
              href={`/p/${p.id}`}
              prefetch={false}
              className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              <ProductCard product={p} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
