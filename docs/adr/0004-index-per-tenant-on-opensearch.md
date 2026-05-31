# ADR-0004: Index-per-tenant on OpenSearch

**Status:** Accepted
**Date:** 2026-05-29

## Context

The hero feature is search. The platform allows tenants to define their own typed product attributes (string/number/boolean/enum/date); the search service indexes those attributes and exposes them as facets. We need a way to:

1. Map each tenant's attribute definitions to OpenSearch field mappings so that faceting works correctly (a `color` keyword is different from a `weight_kg` number).
2. Isolate tenants — a query as t-fashion must never match t-electronics' data.
3. Evolve mappings as tenants add new attributes, without disrupting other tenants.

The catalog data store uses Postgres RLS for isolation (single table, filter per query — see [ADR-0003](0003-rls-not-where-only.md)). OpenSearch is a different beast: no RLS, no per-row policies, and mapping changes are expensive.

## Decision

**Index-per-tenant on OpenSearch.** Each tenant's products live in their own `products-<slugified-tenant>` index. Mapping is derived from the tenant's `attribute_definitions` at index creation time (`buildMapping(defs)` in `packages/modules/search/src/indexer/mapping-manager.ts`). New attribute definitions trigger a `putMapping` PUT against just that tenant's index.

Cross-tenant query is *physically impossible* from the api: `TenantSearchClient.forTenant(tenantId)` returns a `TenantIndex` bound to one index name at construction. No method takes an index-name parameter. Isolation isn't a runtime check — it's the absence of any API surface for the wrong call.

The index is created with `dynamic: 'strict'` so a product document containing an attribute that hasn't been declared as a definition is rejected, rather than allowing OS to silently infer a type.

## Consequences

- Cross-tenant query at the search layer is impossible *by construction*, not by remembering to add a filter. This is the strongest possible guarantee.
- Mapping evolution scopes per-tenant: t-fashion adding a `material` attribute leaves t-electronics' index untouched. No global mapping change, no global rebuild risk.
- Tenant onboarding is `ensureIndex(initialMapping)` — cheap, idempotent.
- Tenant offboarding is `deleteIndex` — also cheap. No row-by-row cleanup, no orphan rows.
- This *does not* scale to many thousands of tenants. Each OpenSearch index has overhead (segments, mapping memory, recovery cost). At ~hundreds of tenants we'd revisit this. At three (the demo) and even hundreds (a realistic B2B SaaS) it's fine.
- Aggregations across tenants are now impossible without explicit multi-index queries, but we don't need that and a single-index-with-tenant-filter design would have foreclosed cross-tenant aggregations too, since the tenant filter would always be required.

## Alternatives considered

**Single index with a `tenant_id` field and a mandatory filter on every query.** Same shape as the Postgres RLS story. Mapping is global so one tenant's attribute name collision (`color` is string for one tenant, integer for another) breaks the world. Faceting on a tenant-specific attribute requires runtime filtering of facet buckets. The isolation guarantee depends entirely on remembering the filter on every query — the same discipline failure mode RLS exists to neutralise, and OpenSearch has no RLS-equivalent.

**Single index with typed sub-fields by attribute type (`attr_string.color`, `attr_number.weight`).** Considered seriously. Stable mapping, faceted-ready, doesn't churn when a tenant adds an attribute. The right choice if scale-to-many-tenants matters. We chose against because the index-per-tenant story makes mapping derivation a clean function of `attribute_definitions` and the isolation claim is stronger.

**Per-tenant OpenSearch CLUSTER.** Overkill at any realistic scale. Operationally horrible.

## Consequences for the seed

The seed CLI bulk-indexes via the same `TenantSearchClient.forTenant(tenant).bulkIndex(docs)` code path the live indexer uses. 99k products in ~10s on a laptop; the integrity of the production code path is what's being demonstrated.

## Links

- [packages/shared/opensearch/src/tenant-search-client.ts](../../packages/shared/opensearch/src/tenant-search-client.ts) — the wrapper enforcing the invariant
- [packages/modules/search/src/indexer/mapping-manager.ts](../../packages/modules/search/src/indexer/mapping-manager.ts) — `attribute_definitions` → OS mapping
- [packages/modules/search/src/indexer/product-indexer.service.ts](../../packages/modules/search/src/indexer/product-indexer.service.ts) — subscribes to catalog events, applies mapping updates per tenant
- **Test:** [packages/modules/search/src/search.integration.spec.ts](../../packages/modules/search/src/search.integration.spec.ts) — physical isolation, mapping evolution, redelivery idempotency
