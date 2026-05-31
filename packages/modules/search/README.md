# modules/search

The hero feature. Per-tenant OpenSearch indexer driven by catalog events + GraphQL `Query.search` for faceted, attribute-aware queries.

See **[ADR-0004](../../../docs/adr/0004-index-per-tenant-on-opensearch.md)** for the index-per-tenant decision.

## Public surface (`contracts/`)

- `SearchQuery = { query?, filters?, facets?, limit?, cursor? }`
- `SearchResult = { items, facets, total, nextCursor, latencyMs }`
- `ProductHit = { id, sku, name, attributes }`
- `Facet`, `FacetBucket`, `AttributeFilter`

## Internals (`src/`)

- `indexer/`
  - `product-indexer.service.ts` — subscribes to `catalog.*` events; idempotent via `IdempotencyTracker`; `ensureIndex` is memoized as an in-flight promise to win a concurrent-create race
  - `mapping-manager.ts` — turns each tenant's `AttributeDefinition[]` into an OS mapping
  - `document-builder.ts` — `Product` → flat OS document (attributes hoisted to `attr_<code>`)
- `search/`
  - `query-builder.ts` — `SearchQuery` → OpenSearch bool/filter/aggs body
  - `search.service.ts` — runs the query, builds the response, attaches `latencyMs`
  - `search.resolver.ts` + `graphql-types.ts` — GraphQL surface
- `search.module.ts`

## GraphQL

```graphql
type Query { search(input: SearchInput!): SearchResult! }

input SearchInput {
  query: String
  filters: [AttributeFilterInput!]
  facets: [String!]
  limit: Int = 20
  cursor: String
}

type SearchResult {
  items: [ProductHit!]!
  facets: [Facet!]!
  total: Int!
  nextCursor: String
  latencyMs: Int!
}
```

Resolver reads `tenantId` from ALS via `currentTenantOrThrow()` — same middleware chain as REST.

## Indices

`products-<slugified-tenant>` per tenant. Created with `dynamic: 'strict'`. Settings: 1 shard, 0 replicas (single-node dev). Mapping fields:

| Catalog attribute type | OS mapping |
|---|---|
| `string`, `enum` | `keyword` |
| `number` | `double` |
| `boolean` | `boolean` |
| `date` | `date` |

## Tests of note

- `mapping-manager.spec.ts` — base properties, attribute→OS-type translation
- `document-builder.spec.ts` — Product → document flatten
- `query-builder.spec.ts` — text/eq/in/range filter assembly, facet aggs, limit clamp, cursor parse
- `search.integration.spec.ts` — physical isolation, mapping evolution per tenant, product update re-index, delete, idempotency on redelivery, separate indices on disk

## Deliberately not built

- Synonyms, custom analyzers, multi-language analysis
- Autocomplete, did-you-mean
- Reindex on attribute type change (additive-only mapping evolution today)
- Real-time delta indexing under high throughput (single-process bus is fine for the demo)
