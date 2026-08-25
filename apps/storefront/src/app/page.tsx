import { CatalogSearchDocument } from '@platform/api-client';
import { graphqlQuery } from '@/lib/api-graphql';
import { getTenantId } from '@/lib/tenant';
import { getMoneyFormat } from '@/lib/capabilities';
import { FacetSidebar } from '@/components/facet-sidebar';
import { Pagination } from '@/components/pagination';
import { ProductGrid } from '@/components/product-grid';
import { SearchBar } from '@/components/search-bar';
import { Toolbar } from '@/components/toolbar';
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
  description: 'Browse the catalog by color, size, brand, and price.',
};

interface PageProps {
  searchParams?: StorefrontSearchParams;
}

export default async function HomePage({ searchParams = {} }: PageProps) {
  const tenantId = getTenantId();
  const parsed = parseSearchParams(searchParams);

  const money = await getMoneyFormat();
  const data = await graphqlQuery(CatalogSearchDocument, parsed.variables, {
    tags: [`browse:${tenantId}`],
  });
  const search = data.search;

  return (
    <main className="container mx-auto px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight md:text-3xl">Browse the catalog</h1>
      <div className="mb-6">
        <SearchBar money={money} basePath="/" searchParams={searchParams} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <FacetSidebar
          facets={search?.facets ?? []}
          selections={parsed.selections}
          baseSearchParams={searchParams}
          basePath="/"
          priceMin={parsed.priceMin}
          priceMax={parsed.priceMax}
          inStockOnly={parsed.inStockOnly}
        />
        <div>
          <Toolbar
            basePath="/"
            searchParams={searchParams}
            sort={parsed.sort}
            view={parsed.view}
            total={search?.total ?? 0}
            latencyMs={search?.latencyMs}
          />
          <ProductGrid money={money} items={search?.items ?? []} view={parsed.view} />
          <Pagination
            basePath="/"
            searchParams={searchParams}
            page={parsed.page}
            total={search?.total ?? 0}
          />
        </div>
      </div>
    </main>
  );
}
