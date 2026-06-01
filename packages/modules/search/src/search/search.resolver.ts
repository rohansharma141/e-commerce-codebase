import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { currentTenantOrThrow } from '@platform/shared/tenant-context';
import type { AttributeFilter, SearchQuery, SortOption } from '@platform/modules/search/contracts';
import { SearchService } from './search.service';
import { ProductHitType, SearchInput, SearchResultType } from './graphql-types';

@Resolver()
export class SearchResolver {
  constructor(private readonly searchService: SearchService) {}

  @Query(() => SearchResultType, { name: 'search' })
  async search(@Args('input') input: SearchInput): Promise<SearchResultType> {
    // Tenant is bound by TenantMiddleware via ALS upstream; GraphQL runs inside
    // the same Express middleware chain so currentTenantOrThrow() works here.
    const tenant = currentTenantOrThrow();
    const query: SearchQuery = {
      query: input.query,
      facets: input.facets,
      limit: input.limit,
      cursor: input.cursor,
      sort: input.sort as SortOption | undefined,
      filters: (input.filters ?? []).map(
        (f): AttributeFilter => ({
          attribute: f.attribute,
          eq: f.eq,
          gte: f.gte,
          lte: f.lte,
          in: f.in,
        }),
      ),
    };
    const result = await this.searchService.search(tenant.tenantId, query);
    return result as SearchResultType;
  }

  /**
   * Storefront product detail page entry point. Returns the same hit shape
   * `search` does — the JSON `attributes` blob carries the custom-attribute
   * payload. Nullable: `null` is a normal "not found" response, not an error.
   */
  @Query(() => ProductHitType, { name: 'product', nullable: true })
  async product(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ProductHitType | null> {
    const tenant = currentTenantOrThrow();
    const hit = await this.searchService.getById(tenant.tenantId, id);
    return hit as ProductHitType | null;
  }
}
