export interface AttributeFilter {
  readonly attribute: string;
  readonly eq?: string | number | boolean;
  readonly gte?: number;
  readonly lte?: number;
  readonly in?: readonly (string | number | boolean)[];
}

/**
 * Storefront-facing sort options. RELEVANCE is the default and keeps the
 * existing _score → name.keyword tiebreak. PRICE_ASC/DESC sort on the
 * denormalised `attr_price` field (every tenant's products have a price
 * attribute today). NAME_ASC is alphabetical browse. Adding more options
 * (e.g. NEWEST) requires a per-tenant date field in the index.
 */
export type SortOption = 'RELEVANCE' | 'PRICE_ASC' | 'PRICE_DESC' | 'NAME_ASC';

export interface SearchQuery {
  readonly query?: string;
  readonly filters?: readonly AttributeFilter[];
  readonly facets?: readonly string[];
  readonly limit?: number;
  readonly cursor?: string;
  readonly sort?: SortOption;
}
