# apps/seed

CLI that bulk-loads representative data so the rest of the demo has something to show. Talks directly to OpenSearch and Postgres (the api is not required to be running). Uses the same code paths the live indexer and pricing module use — the seed is *not* a side path.

## What it does

Per tenant fixture (default: `t-fashion`, `t-electronics`, `t-books`):

1. **Catalog/Search**: builds the per-tenant OpenSearch mapping from the fixture's attribute set, bulk-indexes ~33k synthetic products into `products-<tenant>` via the same `TenantSearchClient.bulkIndex` the indexer uses.
2. **Pricing**: writes `pricing.tenant_config` (currency + tax rate), bulk-upserts a unit price for every product, inserts a few sample promotions (coupon code + automatic cart-min or contains-product).
3. **Benchmark**: runs ~200 random search queries per tenant, prints p50/p95/p99 latency.

## Usage

```bash
pnpm seed                                   # uses defaults
SEED_PRODUCTS_PER_TENANT=3000 pnpm seed      # smaller seed for fast smoke runs
SEED_PRODUCTS_PER_TENANT=100000 pnpm seed    # bigger seed for performance demos
```

| Env var | Default | Purpose |
|---|---|---|
| `SEED_PRODUCTS_PER_TENANT` | `33000` | Products per tenant |
| `SEED_BULK_SIZE` | `500` | OS bulk-index batch size |
| `SEED_SEARCH_SAMPLES` | `200` | Post-seed search queries |
| `OPENSEARCH_URL` | `http://localhost:9200` | |
| `DATABASE_URL` | `postgres://platform:platform@localhost:5432/platform` | |

## Output (sample)

```
seed: 99,000 products across 3 tenants
  opensearch: http://localhost:9200
  per-tenant: 33,000
  bulk size:  500

  t-fashion: 33,000 indexed in 3.4s (index: products-t-fashion)
  t-electronics: 33,000 indexed in 2.3s (index: products-t-electronics)
  t-books: 33,000 indexed in 3.3s (index: products-t-books)

seed: indexed 99,000 products in 9.6s
  bulk batch (size=500): p50=25ms p95=80ms p99=163ms max=332ms

pricing: writing tenant_config, prices, promotions to Postgres
  t-fashion       USD tax=8.75%  prices=33,000  promos=2
  t-electronics   USD tax=7.25%  prices=33,000  promos=2
  t-books         USD tax=0.00%  prices=33,000  promos=1

post-seed search: 200 random queries per tenant
  t-fashion     p50=3ms  p95=6ms  p99=11ms  avg=3.5ms
  t-electronics p50=3ms  p95=10ms p99=21ms  avg=3.6ms
  t-books       p50=1ms  p95=6ms  p99=21ms  avg=2.1ms

seed: done.
```

## Why not seed via the api's REST?

100k POSTs against `/admin/products` would be a multi-minute affair. The seed uses the same transforms (`productToDocument`, `buildMapping`) the live event-driven indexer uses, so what's verified by the seed is also what runs in production. The api is exercised by the integration tests, not by the seed.

## Repeatability

The seed wipes and re-seeds every time. Indices are deleted before re-creation. Pricing tables are TRUNCATE'd per tenant before inserts. The product IDs are random per run; downstream demos that need a specific product should fetch one from the search index first.
