import type { CatalogSearchQueryVariables } from '@platform/api-client';

/**
 * Convert Next.js searchParams into the SearchInput shape the api expects.
 *
 * URL contract:
 *   ?q=shirt          — full-text query
 *   ?color=blue&color=red    — multi-value facet filter (OR within attribute)
 *   ?size=M&size=L
 *   ?brand=Acme
 *   ?page=2                  — pagination (limit fixed at 24 for now)
 *
 * Multi-value parameters become `{ attribute, in: [...] }` filters. The
 * facets returned in `facets:` are fixed for the catalog browse experience
 * — when we add a dedicated product-detail or category page, those routes
 * pass their own facets list.
 *
 * Defined inside the storefront (NOT in api-client) because it's a UI
 * concern: how URL state maps onto the api's SearchInput. The api shape is
 * the contract; the URL→input translation is presentation.
 */

const FACET_ATTRIBUTES = ['color', 'size', 'brand'] as const;
const PAGE_SIZE = 24;

export type StorefrontSearchParams = Record<string, string | string[] | undefined>;

export interface ParsedSearch {
  variables: CatalogSearchQueryVariables;
  selections: ReadonlyMap<string, ReadonlySet<string>>;
  page: number;
  query: string | null;
}

export function parseSearchParams(searchParams: StorefrontSearchParams, category?: string): ParsedSearch {
  const filters: Array<{
    attribute: string;
    in?: string[];
    eq?: string;
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

  const q = pickString(searchParams['q']);
  const page = Math.max(1, Number.parseInt(pickString(searchParams['page']) ?? '1', 10) || 1);

  return {
    selections,
    page,
    query: q ?? null,
    variables: {
      input: {
        query: q,
        facets: [...FACET_ATTRIBUTES],
        filters,
        limit: PAGE_SIZE,
      },
    },
  };
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export const PAGE_SIZE_FOR_DISPLAY = PAGE_SIZE;
