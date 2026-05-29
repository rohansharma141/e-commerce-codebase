import { Args, Query, Resolver } from '@nestjs/graphql';
import { currentTenantOrThrow } from '@platform/shared/tenant-context';
import type { AttributeFilter, SearchQuery } from '@platform/modules/search/contracts';
import { SearchService } from './search.service';
import { SearchInput, SearchResultType } from './graphql-types';

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
}
