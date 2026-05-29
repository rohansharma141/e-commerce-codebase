export interface AttributeFilter {
  readonly attribute: string;
  readonly eq?: string | number | boolean;
  readonly gte?: number;
  readonly lte?: number;
  readonly in?: readonly (string | number | boolean)[];
}

export interface SearchQuery {
  readonly query?: string;
  readonly filters?: readonly AttributeFilter[];
  readonly facets?: readonly string[];
  readonly limit?: number;
  readonly cursor?: string;
}
