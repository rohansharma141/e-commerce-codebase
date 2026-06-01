import type { AttributeFilter, SearchQuery } from '@platform/modules/search/contracts';
import { attributeFieldName } from '../indexer/mapping-manager';

interface OsBoolQuery {
  bool: {
    must?: unknown[];
    filter?: unknown[];
  };
}

export interface BuiltSearchBody {
  size: number;
  from: number;
  /**
   * `track_total_hits: true` overrides OpenSearch's default cap of 10,000
   * for `hits.total.value`. With 33k+ products per tenant the cap was
   * surfacing as "10,000 products" in the storefront, which read as a
   * misleading product-count claim. The cost is small on indices of this
   * size and is the right default for a catalog facade — pagination and
   * facets need an accurate total to behave correctly.
   */
  track_total_hits: true;
  query: OsBoolQuery;
  aggs?: Record<string, unknown>;
  sort?: unknown[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

export function buildSearchBody(input: SearchQuery): BuiltSearchBody {
  const size = clampLimit(input.limit);
  const from = parseCursor(input.cursor);

  const must: unknown[] = [];
  if (input.query && input.query.trim().length > 0) {
    // Autocomplete mode swaps the strict and-of-terms match for a phrase
    // prefix: typing "cam" matches "camera bag", "Camera Z6", etc. Slower
    // for large indices but appropriate for ≤ 8-hit type-ahead UX where
    // the user gets a result on every keystroke.
    must.push(
      input.autocomplete
        ? { match_phrase_prefix: { name: input.query } }
        : { match: { name: { query: input.query, operator: 'and' } } },
    );
  }

  const filter: unknown[] = [];
  for (const f of input.filters ?? []) {
    filter.push(filterClause(f));
  }

  const body: BuiltSearchBody = {
    size,
    from,
    track_total_hits: true,
    query: {
      bool: {
        ...(must.length ? { must } : {}),
        ...(filter.length ? { filter } : {}),
      },
    },
    sort: sortClause(input.sort),
  };

  if (input.facets && input.facets.length > 0) {
    body.aggs = {};
    for (const code of input.facets) {
      body.aggs[`facet_${code}`] = {
        terms: { field: attributeFieldName(code), size: 50 },
      };
    }
  }

  return body;
}

/**
 * OpenSearch sort clauses per storefront sort option.
 *
 * - RELEVANCE (default): score-first, then alphabetic tiebreak.
 * - PRICE_ASC/DESC: by denormalised `attr_price` (a double on every tenant's
 *   index). Missing values sort last under ASC and first under DESC, which
 *   matches what a shopper expects ("cheapest first" shouldn't put unpriced
 *   items at the top).
 * - NAME_ASC: pure alphabetical via the `.keyword` sub-field on `name`.
 */
function sortClause(sort: SearchQuery['sort']): unknown[] {
  switch (sort) {
    case 'PRICE_ASC':
      return [{ attr_price: { order: 'asc', missing: '_last' } }, { 'name.keyword': 'asc' }];
    case 'PRICE_DESC':
      return [{ attr_price: { order: 'desc', missing: '_last' } }, { 'name.keyword': 'asc' }];
    case 'NAME_ASC':
      return [{ 'name.keyword': 'asc' }];
    case 'RELEVANCE':
    default:
      return [{ _score: 'desc' }, { 'name.keyword': 'asc' }];
  }
}

function filterClause(f: AttributeFilter): Record<string, unknown> {
  const field = attributeFieldName(f.attribute);
  if (f.eq !== undefined) {
    return { term: { [field]: f.eq } };
  }
  if (f.in && f.in.length > 0) {
    return { terms: { [field]: f.in } };
  }
  if (f.gte !== undefined || f.lte !== undefined) {
    const range: Record<string, number> = {};
    if (f.gte !== undefined) range['gte'] = f.gte;
    if (f.lte !== undefined) range['lte'] = f.lte;
    return { range: { [field]: range } };
  }
  // Filter with no operator: match-all (no-op). Avoids empty-body bugs.
  return { match_all: {} };
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit as number), MAX_LIMIT);
}

/**
 * Cursors here are simple offset strings. Good enough for the hero demo;
 * deep-pagination ("search_after") is a step-5 concern. Refuse invalid cursors
 * loudly so a bad client can't bypass the limit by sending "from=999999".
 */
function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 10);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) {
    throw new Error(`invalid cursor: ${cursor}`);
  }
  return n;
}

export function nextCursorFor(from: number, size: number, total: number): string | null {
  const next = from + size;
  return next < total ? String(next) : null;
}
