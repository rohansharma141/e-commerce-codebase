import { CatalogSearchDocument } from '@platform/api-client';
import { graphqlQuery } from '@/lib/api-graphql';
import { getTenantId } from '@/lib/tenant';
import { FacetSidebar } from '@/components/facet-sidebar';
import { ProductGrid } from '@/components/product-grid';
import { parseSearchParams, type StorefrontSearchParams } from '@/lib/search-params';

/**
 * Browse-everything page. Tagged `browse:<tenantId>` so catalog mutations
 * revalidate every browse render for that tenant. Search params still drive
 * the variables — Next's cache keys include the entire fetch payload, so
 * different filter combinations each get their own cache entry, all sharing
 * the same tag for bulk invalidation.
 */

export const metadata = {
  title: 'Browse',
  description: 'Browse the catalog by color, size, and brand.',
};

interface PageProps {
  searchParams?: StorefrontSearchParams;
}

export default async function HomePage({ searchParams = {} }: PageProps) {
  const tenantId = getTenantId();
  const { variables, selections } = parseSearchParams(searchParams);

  const data = await graphqlQuery(CatalogSearchDocument, variables, {
    tags: [`browse:${tenantId}`],
  });

  const search = data.search;

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
