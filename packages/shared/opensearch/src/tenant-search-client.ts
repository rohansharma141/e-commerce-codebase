import type { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { indexNameFor } from './index-naming';

export type OsMappingProperty =
  | { type: 'keyword' }
  | { type: 'text'; fields?: Record<string, OsMappingProperty> }
  | { type: 'double' }
  | { type: 'long' }
  | { type: 'boolean' }
  | { type: 'date' };

export interface OsMapping {
  properties: Record<string, OsMappingProperty>;
}

export interface BulkDoc {
  readonly id: string;
  readonly source: Record<string, unknown>;
}

/**
 * Handle to a single tenant's OpenSearch index. Constructed via
 * TenantSearchClient.forTenant(); every method runs against this.indexName.
 * No method accepts an index-name parameter — cross-tenant query is impossible
 * by construction.
 */
export class TenantIndex {
  constructor(
    private readonly os: OpenSearchClient,
    readonly indexName: string,
  ) {}

  async ensureIndex(initialMapping: OsMapping): Promise<void> {
    const exists = await this.os.indices.exists({ index: this.indexName });
    if (exists.body) return;
    await this.os.indices.create({
      index: this.indexName,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
        },
        // dynamic: 'strict' makes the index reject documents containing fields
        // not yet in the mapping. Combined with the indexer's deferral on
        // strict_dynamic_mapping_exception, this prevents the race where a
        // product.created event arrives ahead of its tenant's
        // attribute-definition.created and indexes attr_<code> as the wrong
        // OpenSearch-inferred type (text vs keyword).
        mappings: { dynamic: 'strict', ...initialMapping },
      },
    });
  }

  /**
   * Adds new fields to the existing mapping. OpenSearch supports adding fields
   * but never removing or retyping them; that requires a reindex (out of scope).
   */
  async putMapping(properties: OsMapping['properties']): Promise<void> {
    await this.os.indices.putMapping({
      index: this.indexName,
      body: { properties },
    });
  }

  async indexDoc(id: string, doc: Record<string, unknown>): Promise<void> {
    await this.os.index({
      index: this.indexName,
      id,
      body: doc,
      refresh: false,
    });
  }

  async bulkIndex(docs: readonly BulkDoc[]): Promise<{ errors: boolean; took: number }> {
    if (docs.length === 0) return { errors: false, took: 0 };
    const body: Record<string, unknown>[] = [];
    for (const d of docs) {
      body.push({ index: { _index: this.indexName, _id: d.id } });
      body.push(d.source);
    }
    const res = await this.os.bulk({ body, refresh: false });
    const respBody = res.body as Record<string, unknown>;
    return {
      errors: Boolean(respBody['errors']),
      took: (respBody['took'] as number | undefined) ?? 0,
    };
  }

  async deleteDoc(id: string): Promise<void> {
    try {
      await this.os.delete({ index: this.indexName, id, refresh: false });
    } catch (err) {
      // 404 on delete is fine — the doc may have been deleted by a redelivery
      // or never indexed (eventually-consistent).
      if (isNotFound(err)) return;
      throw err;
    }
  }

  async refresh(): Promise<void> {
    await this.os.indices.refresh({ index: this.indexName });
  }

  async search<T = unknown>(body: Record<string, unknown>): Promise<{
    took: number;
    hits: { total: { value: number }; hits: { _id: string; _source: T }[] };
    aggregations?: Record<string, unknown>;
  }> {
    const res = await this.os.search({
      index: this.indexName,
      body,
    });
    return res.body as never;
  }

  /**
   * Single-document lookup by id. Returns the `_source` payload or `null`
   * when the doc (or the whole tenant index) is missing. The `null` shape
   * is intentional — callers should treat "no such product" as a normal
   * 404 path, not an exception.
   */
  async getById<T = unknown>(id: string): Promise<T | null> {
    try {
      const res = await this.os.get({ index: this.indexName, id });
      return (res.body as { _source: T })._source;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteIndex(): Promise<void> {
    try {
      await this.os.indices.delete({ index: this.indexName });
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
  return status === 404;
}

/**
 * Factory: tenantSearchClient.forTenant(tenantId) returns a TenantIndex bound
 * to that tenant's index. Mirrors the database tenant-binding pattern from
 * packages/shared/database/tenant-binding.ts: isolation by construction, not
 * by remembering to add a filter on each query.
 */
export class TenantSearchClient {
  constructor(private readonly os: OpenSearchClient) {}

  forTenant(tenantId: string): TenantIndex {
    return new TenantIndex(this.os, indexNameFor(tenantId));
  }
}
