import type { CatalogSearchQueryVariables } from '@platform/api-client';

/**
 * URL → SearchInput translation. The URL is the single source of truth for
 * everything that affects what gets rendered: free-text query, facet
 * selections, price range, in-stock filter, sort, view mode, pagination.
 * The page is a pure function of the URL, which means Back/Forward, share-
 * able URLs, and "open in new tab" all just work.
 *
 * URL contract:
 *   ?q=shirt                   — full-text query
 *   ?color=blue&color=red      — multi-value facet (OR within attribute)
 *   ?size=M&size=L
 *   ?brand=Acme
 *   ?price-min=10              — number, dollars
 *   ?price-max=200
 *   ?in_stock=1                — only in-stock items
 *   ?sort=price-asc|price-desc|name-asc   (defaults to relevance)
 *   ?view=list                 (defaults to grid)
 *   ?page=2                    — pagination
 *
 * Defined inside the storefront (NOT in api-client) because it's a UI
 * concern: how URL state maps onto the api's SearchInput. The api shape
 * is the contract; the URL→input translation is presentation.
 */

const FACET_ATTRIBUTES = ['color', 'size', 'brand'] as const;
const PAGE_SIZE = 24;

export type StorefrontSearchParams = Record<string, string | string[] | undefined>;
export type ViewMode = 'grid' | 'list';
export type SortKey = 'relevance' | 'price-asc' | 'price-desc' | 'name-asc';

export interface ParsedSearch {
  variables: CatalogSearchQueryVariables;
  selections: ReadonlyMap<string, ReadonlySet<string>>;
  page: number;
  query: string | null;
  view: ViewMode;
  sort: SortKey;
  priceMin: number | null;
  priceMax: number | null;
  inStockOnly: boolean;
}

const SORT_TO_GRAPHQL: Record<SortKey, string> = {
  relevance: 'RELEVANCE',
  'price-asc': 'PRICE_ASC',
  'price-desc': 'PRICE_DESC',
  'name-asc': 'NAME_ASC',
};

export function parseSearchParams(
  searchParams: StorefrontSearchParams,
  category?: string,
): ParsedSearch {
  const filters: Array<{
    attribute: string;
    in?: string[];
    eq?: string;
    gte?: number;
    lte?: number;
  }> = [];
  const selections = new Map<string, Set<string>>();

  for (const attr of FACET_ATTRIBUTES) {
    const raw = searchParams[attr];
    if (!raw) continue;
    const values = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
    if (values.length === 0) continue;
    filters.push({ attribute: attr, in: values });
    selections.set(attr, new Set(values));
  }

  if (category) {
    filters.push({ attribute: 'category', eq: category });
  }

  const priceMin = parseNumber(pickString(searchParams['price-min']));
  const priceMax = parseNumber(pickString(searchParams['price-max']));
  if (priceMin !== null || priceMax !== null) {
    filters.push({
      attribute: 'price',
      ...(priceMin !== null ? { gte: priceMin } : {}),
      ...(priceMax !== null ? { lte: priceMax } : {}),
    });
  }

  const inStockOnly = pickString(searchParams['in_stock']) === '1';
  if (inStockOnly) {
    filters.push({ attribute: 'in_stock', eq: 'true' });
  }

  const q = pickString(searchParams['q']);
  const page = Math.max(1, Number.parseInt(pickString(searchParams['page']) ?? '1', 10) || 1);
  const view = pickString(searchParams['view']) === 'list' ? 'list' : 'grid';
  const sort = parseSort(pickString(searchParams['sort']));

  return {
    selections,
    page,
    query: q ?? null,
    view,
    sort,
    priceMin,
    priceMax,
    inStockOnly,
    variables: {
      input: {
        query: q,
        facets: [...FACET_ATTRIBUTES],
        filters,
        limit: PAGE_SIZE,
        sort: SORT_TO_GRAPHQL[sort] as never,
      },
    },
  };
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function parseNumber(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseSort(v: string | undefined): SortKey {
  switch (v) {
    case 'price-asc':
    case 'price-desc':
    case 'name-asc':
      return v;
    default:
      return 'relevance';
  }
}

/**
 * Build a relative URL preserving current params with one set of overrides.
 * Used by Toolbar (sort/view) and the in-stock toggle — anything where a
 * single change shouldn't blow away the rest of the filter state.
 */
export function urlWithOverrides(
  basePath: string,
  current: StorefrontSearchParams,
  overrides: Record<string, string | string[] | null>,
): string {
  const params = new URLSearchParams();
  const merged: Record<string, string | string[] | null> = { ...current };
  for (const [k, v] of Object.entries(overrides)) {
    merged[k] = v;
  }
  for (const [k, v] of Object.entries(merged)) {
    if (v === null || v === undefined) continue;
    const values = Array.isArray(v) ? v : [v];
    for (const val of values) params.append(k, val);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export const PAGE_SIZE_FOR_DISPLAY = PAGE_SIZE;
