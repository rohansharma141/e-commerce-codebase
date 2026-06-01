import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  TENANT_SEARCH_CLIENT,
  type TenantSearchClient,
} from '@platform/shared/opensearch';
import type {
  Facet,
  ProductHit,
  SearchQuery,
  SearchResult,
} from '@platform/modules/search/contracts';
import { attributeFieldName } from '../indexer/mapping-manager';
import { buildSearchBody, nextCursorFor } from './query-builder';

interface OsHit {
  _id: string;
  _source: {
    id: string;
    sku: string;
    name: string;
    [k: string]: unknown;
  };
}

interface OsAggBucket {
  key: string | number | boolean;
  doc_count: number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(TENANT_SEARCH_CLIENT) private readonly searchClient: TenantSearchClient,
  ) {}

  async search(tenantId: string, input: SearchQuery): Promise<SearchResult> {
    const body = buildSearchBody(input);
    const idx = this.searchClient.forTenant(tenantId);
    const startedAt = process.hrtime.bigint();

    let response;
    try {
      response = await idx.search<OsHit['_source']>(
        body as unknown as Record<string, unknown>,
      );
    } catch (err) {
      if (isIndexMissing(err)) {
        // A tenant that's never been indexed has no products. Treat as empty
        // rather than 500-ing — it's the "new tenant, no catalog yet" case.
        return emptyResult(startedAt);
      }
      throw err;
    }

    const latencyMs = elapsedMs(startedAt);
    const items = response.hits.hits.map((h): ProductHit => toHit(h));
    const total = response.hits.total.value;
    const facets = parseFacets(response.aggregations, input.facets ?? []);
    const nextCursor = nextCursorFor(body.from, body.size, total);

    this.logger.log(
      `search.completed tenant=${tenantId} index=${idx.indexName} hits=${total} latencyMs=${latencyMs}`,
    );

    return { items, facets, total, nextCursor, latencyMs };
  }

  /**
   * Single-product lookup by id, scoped to the tenant's index. Returns
   * null on miss (no doc, or no index for this tenant yet). Used by the
   * storefront's product detail page; same data shape as a `search` hit
   * so the api-client's generated type covers both call sites.
   */
  async getById(tenantId: string, productId: string): Promise<ProductHit | null> {
    const idx = this.searchClient.forTenant(tenantId);
    try {
      const source = await idx.getById<OsHit['_source']>(productId);
      if (!source) return null;
      return toHit({ _id: productId, _source: source });
    } catch (err) {
      if (isIndexMissing(err)) return null;
      throw err;
    }
  }
}

function toHit(h: OsHit): ProductHit {
  const attributes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h._source)) {
    if (k.startsWith('attr_')) attributes[k.slice('attr_'.length)] = v;
  }
  return {
    id: h._source.id ?? h._id,
    sku: h._source.sku,
    name: h._source.name,
    attributes,
  };
}

function parseFacets(
  aggs: Record<string, unknown> | undefined,
  requested: readonly string[],
): Facet[] {
  if (!aggs) return [];
  const facets: Facet[] = [];
  for (const code of requested) {
    const agg = aggs[`facet_${code}`] as { buckets?: OsAggBucket[] } | undefined;
    if (!agg?.buckets) continue;
    facets.push({
      attribute: code,
      buckets: agg.buckets.map((b) => ({ value: String(b.key), count: b.doc_count })),
    });
  }
  return facets;
}

function isIndexMissing(err: unknown): boolean {
  const e = err as { meta?: { body?: { error?: { type?: string } }; statusCode?: number } };
  return e?.meta?.statusCode === 404 || e?.meta?.body?.error?.type === 'index_not_found_exception';
}

function elapsedMs(startNs: bigint): number {
  return Number((process.hrtime.bigint() - startNs) / 1_000_000n);
}

function emptyResult(startNs: bigint): SearchResult {
  return {
    items: [],
    facets: [],
    total: 0,
    nextCursor: null,
    latencyMs: elapsedMs(startNs),
  };
}

// Make the helper visible without ESM cycles via a re-export. (Used by tests.)
export { attributeFieldName };
