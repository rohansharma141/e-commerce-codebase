# shared/opensearch

OpenSearch client + per-tenant index handle. The physical-isolation layer for the search hero feature.

See **[ADR-0004](../../../docs/adr/0004-index-per-tenant-on-opensearch.md)** for the index-per-tenant decision.

## Public surface

- `createOpenSearchClient(url)` — postgres-style client factory
- `TenantSearchClient.forTenant(tenantId)` → `TenantIndex`
- `TenantIndex.{ensureIndex, putMapping, indexDoc, bulkIndex, deleteDoc, search, refresh, deleteIndex}` — bound to ONE index by construction
- `indexNameFor(tenantId)` — slugify rules + prefix (`products-`)
- `OpenSearchModule` — `@Global`
- Tokens: `OPENSEARCH`, `TENANT_SEARCH_CLIENT`

## The invariant

`TenantIndex` constructed by `TenantSearchClient.forTenant()` is bound to one index name at construction. No method takes an index-name parameter. Cross-tenant query is impossible by construction, not by remembering to add a filter.

The slugifier rejects unsafe characters at boot — a tenant id that survives `TenantMiddleware` validation also survives here.

## Used by

- `packages/modules/search` for both indexing and queries
- `apps/seed` for bulk-loading via the same code paths the live indexer uses
