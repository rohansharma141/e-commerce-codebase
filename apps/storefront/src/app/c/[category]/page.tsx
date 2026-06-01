import { CatalogSearchDocument } from '@platform/api-client';
import { getClient } from '@/lib/urql';
import { FacetSidebar } from '@/components/facet-sidebar';
import { ProductGrid } from '@/components/product-grid';
import { parseSearchParams, type StorefrontSearchParams } from '@/lib/search-params';

/**
 * Category browse — same component as the home page with a pinned
 * `category` filter. The api treats `category` as just another custom
 * attribute on products (matching the platform's tenant-defined-attribute
 * story), so the routing is "/c/shirts" => filter eq:category=shirts.
 *
 * The seed today doesn't write a `category` attribute, so this page renders
 * an empty grid against the demo data — kept here as the routing shape for
 * step 7b's onward work and to prove the URL state plumbing handles
 * dynamic segments.
 */
export const dynamic = 'force-dynamic';

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
  const category = decodeURIComponent(params.category);
  const { variables, selections } = parseSearchParams(searchParams, category);

  const result = await getClient().query(CatalogSearchDocument, variables);
  if (result.error) {
    throw new Error(`api error: ${result.error.message}`);
  }
  const search = result.data?.search;

  return (
    <main className="container mx-auto px-4 py-6">
      <nav className="mb-2 text-xs text-slate-500">
        <a href="/" className="hover:text-slate-900">Home</a>
        <span className="mx-1">/</span>
        <span className="text-slate-700">{category}</span>
      </nav>
      <h1 className="mb-6 text-2xl font-bold tracking-tight capitalize md:text-3xl">{category}</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <FacetSidebar
          facets={search?.facets ?? []}
          selections={selections}
          baseSearchParams={searchParams}
          basePath={`/c/${encodeURIComponent(category)}`}
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
