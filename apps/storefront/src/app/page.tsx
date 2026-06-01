import { CatalogSearchDocument } from '@platform/api-client';
import { getClient } from '@/lib/urql';
import { FacetSidebar } from '@/components/facet-sidebar';
import { ProductGrid } from '@/components/product-grid';
import { parseSearchParams, type StorefrontSearchParams } from '@/lib/search-params';

/**
 * Browse-everything page. Server-rendered on every request (SearchParams
 * drive the GraphQL variables, so caching here would just be a stale URL
 * problem). For categories, see /c/[category]/page.tsx — same component,
 * narrower input filter.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Browse',
  description: 'Browse the catalog by color, size, and brand.',
};

interface PageProps {
  searchParams?: StorefrontSearchParams;
}

export default async function HomePage({ searchParams = {} }: PageProps) {
  const { variables, selections } = parseSearchParams(searchParams);

  const result = await getClient().query(CatalogSearchDocument, variables);

  if (result.error) {
    // Surface api errors in dev — production should render a friendlier
    // fallback. For step 7a we want the failure mode obvious.
    throw new Error(`api error: ${result.error.message}`);
  }

  const search = result.data?.search;

  return (
    <main className="container mx-auto px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold tracking-tight md:text-3xl">Browse the catalog</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <FacetSidebar
          facets={search?.facets ?? []}
          selections={selections}
          baseSearchParams={searchParams}
          basePath="/"
        />
        <ProductGrid
          items={search?.items ?? []}
          total={search?.total ?? 0}
          latencyMs={search?.latencyMs}
        />
      </div>
    </main>
  );
}
