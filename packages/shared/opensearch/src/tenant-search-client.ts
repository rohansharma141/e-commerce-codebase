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

export interface WriteOptions {
  /**
   * `false` (default) returns as soon as the write is durable — it may not be
   * searchable for up to a refresh interval. `'wait_for'` holds until it is.
   * `true` forces an immediate refresh and is deliberately not used here: it
   * is expensive under write load and 'wait_for' gives the same guarantee by
   * riding the next scheduled refresh.
   */
  readonly refresh?: false | 'wait_for';
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

  /**
   * `refresh` controls when the write becomes visible to search. OpenSearch
   * refreshes on its own about once a second, so `false` (the default) means
   * "the write is durable but may not be searchable yet" — right for bulk
   * loads, wrong for anything that announces itself afterwards.
   *
   * `'wait_for'` holds the call until the next refresh cycle. Single-document
   * writes use it so that "indexed" genuinely means "readable", which is what
   * lets downstream consumers re-read without racing.
   */
  async indexDoc(
    id: string,
    doc: Record<string, unknown>,
    opts: WriteOptions = {},
  ): Promise<void> {
    await this.os.index({
      index: this.indexName,
      id,
      body: doc,
      refresh: opts.refresh ?? false,
    });
  }

  /**
   * Partial update of an existing document. Returns false when the document
   * isn't there rather than throwing.
   *
   * Needed because some fields on a product document are owned by a module
   * other than catalog — price being the first — and those owners must be able
   * to correct their own field without holding the rest of the document. A
   * full re-index from a price event would mean the pricing module having to
   * know how to build a catalog document, which is precisely the coupling the
   * event boundary exists to prevent.
   *
   * A missing document is a normal race, not an error: a price can be set for
   * a product that hasn't been indexed yet. The subsequent catalog index will
   * carry the current price anyway, so dropping the update is correct.
   */
  async updateDoc(
    id: string,
    partial: Record<string, unknown>,
    opts: WriteOptions = {},
  ): Promise<boolean> {
    try {
      await this.os.update({
        index: this.indexName,
        id,
        body: { doc: partial },
        refresh: opts.refresh ?? false,
      });
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
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

  async deleteDoc(id: string, opts: WriteOptions = {}): Promise<void> {
    try {
      await this.os.delete({
        index: this.indexName,
        id,
        refresh: opts.refresh ?? false,
      });
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
