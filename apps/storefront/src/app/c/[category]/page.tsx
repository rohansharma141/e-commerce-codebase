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
import { browseTag, categoryTag } from '@/lib/cache-tags';

/**
 * Category browse — same component as the home page with a pinned
 * `category` filter. The api treats `category` as just another custom
 * attribute on products (matching the platform's tenant-defined-attribute
 * story), so the routing is "/c/headphones" => filter eq:category=headphones.
 * t-electronics has `category` populated by the seed; other tenants render
 * empty until their fixtures add one.
 */
interface CategoryPageProps {
  params: { category: string };
  searchParams?: StorefrontSearchParams;
}

export async function generateMetadata({ params }: CategoryPageProps) {
  return {
    title: `Shop ${decodeURIComponent(params.category)}`,
  };
}

export default async function CategoryPage({ params, searchParams = {} }: CategoryPageProps) {
  const tenantId = getTenantId();
  const category = decodeURIComponent(params.category);
  const parsed = parseSearchParams(searchParams, category);
  const basePath = `/c/${encodeURIComponent(category)}`;

  const money = await getMoneyFormat();
  const data = await graphqlQuery(CatalogSearchDocument, parsed.variables, {
    tags: [browseTag(tenantId), categoryTag(tenantId, category)],
  });
  const search = data.search;

  return (
    <main className="container mx-auto px-4 py-6">
      <nav className="mb-2 text-xs opacity-70">
        <a href="/" className="hover:opacity-100">Home</a>
        <span className="mx-1">/</span>
        <span className="opacity-100">{category}</span>
      </nav>
      <h1 className="mb-4 text-2xl font-bold tracking-tight capitalize md:text-3xl">{category}</h1>
      <div className="mb-6">
        <SearchBar money={money} basePath={basePath} searchParams={searchParams} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <FacetSidebar
          facets={search?.facets ?? []}
          selections={parsed.selections}
          baseSearchParams={searchParams}
          basePath={basePath}
          priceMin={parsed.priceMin}
          priceMax={parsed.priceMax}
          inStockOnly={parsed.inStockOnly}
        />
        <div>
          <Toolbar
            basePath={basePath}
            searchParams={searchParams}
            sort={parsed.sort}
            view={parsed.view}
            total={search?.total ?? 0}
            latencyMs={search?.latencyMs}
          />
          <ProductGrid money={money} items={search?.items ?? []} view={parsed.view} />
          <Pagination
            basePath={basePath}
            searchParams={searchParams}
            page={parsed.page}
            total={search?.total ?? 0}
          />
        </div>
      </div>
    </main>
  );
}
