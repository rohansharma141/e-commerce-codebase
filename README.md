# e-commerce-codebase

Enterprise commerce platform: multi-tenant, headless, API-first. Built from scratch as a portfolio piece demonstrating platform-architecture capability. **Depth over breadth** — a hero feature that sings on a clean spine, with a sharp architecture story.

**Stack**: Node.js + TypeScript, NestJS, PostgreSQL (orders/tenancy/money), OpenSearch (search), Redis (cart/sessions), Drizzle ORM, GraphQL (storefront reads) + REST (admin/system), pnpm + Nx monorepo.

**Hero feature**: faceted search-at-scale on tenant-defined typed attributes, with per-tenant physical isolation in OpenSearch and Postgres RLS killing cross-tenant access at the database layer.

---

## 60-second tour

```bash
git clone https://github.com/rohansharma141/e-commerce-codebase
cd e-commerce-codebase
docker compose up --build      # ~30s once images are pulled; first run pulls images
pnpm install                   # installs the monorepo
pnpm seed                      # ~10s; 99k products + prices + sample promotions across 3 tenants
```

When the seed finishes, the api is live at `http://localhost:3000`:

| Endpoint | Description |
|---|---|
| `/health` | Liveness (always 200 if process is up) |
| `/ready` | Readiness — probes Postgres, Redis, OpenSearch (503 if any are down) |
| `/graphql` | Storefront GraphQL — `Query.search` is the hero |
| `/docs` | Swagger UI for the REST surface |
| `/admin/*` | Admin REST: products, attribute-definitions, prices, promotions, orders |
| `/storefront/carts`, `/storefront/checkout` | Storefront REST: cart + checkout |

> **Tip**: every tenant-scoped endpoint requires an `x-tenant-id: <id>` header. The seed creates three tenants: `t-fashion`, `t-electronics`, `t-books`.

### Storefront

A Next.js storefront ships alongside the api as a separately-deployable artifact. To run it:

```bash
pnpm nx serve storefront
```

Then open `http://t-fashion.localhost:3001/` (or `t-electronics`, `t-books`). Modern browsers resolve `*.localhost` natively — no `/etc/hosts` edits.

The storefront imports ONLY from `@platform/api-client` and talks to the api exclusively over the public GraphQL + REST schema. The sellable-separately rule is enforced by ESLint. See [docs/STOREFRONT.md](docs/STOREFRONT.md).

---

## Three verifiable claims

The repo's claims are reproducible by anyone with the stack up. Each takes <60s.

### 1. Hero — faceted search at p95 < 100ms on 100k products

```bash
curl -s -X POST http://localhost:3000/graphql \
  -H 'x-tenant-id: t-fashion' \
  -H 'content-type: application/json' \
  -d '{
    "query": "query($input:SearchInput!){search(input:$input){total latencyMs items{sku attributes} facets{attribute buckets{value count}}}}",
    "variables":{"input":{"filters":[{"attribute":"brand","eq":"Acme"}],"facets":["color","size"],"limit":5}}
  }'
```

You should see `total: ~5,400`, `latencyMs` < 50ms (after warm-up), and color/size facet buckets with counts. The seed CLI itself prints p50/p95/p99 over 200 random queries per tenant — usually p95 ≤ 10ms.

### 2. Tenant isolation — RLS is the real guard, not an app-layer filter

Two killshots, run via psql:

```bash
# As the platform role with NO app.tenant_id set → should be 0
docker exec e-commerce-codebase-postgres-1 psql -U platform -d platform \
  -c "SELECT count(*) AS unbound FROM catalog.products;"

# With app.tenant_id bound → returns t-fashion's products
docker exec e-commerce-codebase-postgres-1 psql -U platform -d platform \
  -c "SELECT set_config('app.tenant_id', 't-fashion', false); SELECT count(*) FROM catalog.products;"

# Confirm via the postgres superuser bypass that the rows actually exist
docker exec e-commerce-codebase-postgres-1 psql -U postgres -d platform \
  -c "SELECT count(*) AS true_count FROM catalog.products;"
```

The same shape works on `orders.orders` and `pricing.*`. See [ADR-0003](docs/adr/0003-rls-not-where-only.md) for why this is the load-bearing test.

### 3. Snapshot integrity — historical orders never mutate when live config changes

```bash
# (after the curl flow above produced an order, captured as ORDER_ID)
# Edit the promotion the order used:
curl -s -X PATCH "http://localhost:3000/admin/promotions/$PROMO_ID" \
  -H 'x-tenant-id: t-fashion' -H 'content-type: application/json' \
  -d '{"action":{"type":"percent","value":9000}}'

# Re-fetch the order — actionValue, discountCents, grandTotalCents
# are all UNCHANGED.
curl -s "http://localhost:3000/admin/orders/$ORDER_ID" -H 'x-tenant-id: t-fashion'
```

---

## Architecture

Modular monolith, not microservices. Three disciplines preserve a clean future split:

1. **No cross-module SQL joins, ever.** Every module owns its own Postgres schema (`catalog`, `pricing`, `orders`, `audit`).
2. **Events are network-strict** — plain serializable objects, idempotent consumers, `structuredClone` on dispatch.
3. **No cross-module `src/` imports** — ESLint `@nx/enforce-module-boundaries` enforces this at build time.

```
apps/
  api/                  the single deployable
  seed/                 a CLI that bulk-loads 99k products + prices + promotions

packages/
  shared/
    config/             env validation (zod)
    database/           Drizzle + postgres-js + per-module migrator + per-request tenant binding
    event-bus/          in-process pub/sub with structuredClone isolation
    hooks/              extension-point registry (observer-only today)
    observability/      /ready endpoint
    opensearch/         per-tenant OS client (physical-isolation by construction)
    redis/              namespaced TenantRedisClient
    security/           helmet, throttler, audit-log interceptor
    tenant-context/     ALS-bound tenant + requestId + middleware
  modules/
    catalog/            products + tenant-defined typed attributes
    search/             OpenSearch indexer + GraphQL Query.search
    pricing/            prices, tax, promotion engine (best-single stacking)
    cart/               Redis-backed cart, snapshots sku/name at add-time
    orders/             transactional core: checkout, snapshot, idempotency
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the dependency map, module-by-module description, event topology, and the "extraction map" — which modules would split first if we ever went distributed.

---

## Reading order for a code review

1. **[CLAUDE.md](CLAUDE.md)** — the operational rules.
2. **[docs/DECISIONS.md](docs/DECISIONS.md)** — the reasoning behind every decision.
3. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — module map + flows.
4. **[docs/adr/](docs/adr/)** — load-bearing decisions, each interrogable on its own.
5. The hero: [packages/modules/search](packages/modules/search/) + [packages/shared/opensearch](packages/shared/opensearch/) + the [search integration tests](packages/modules/search/src/search.integration.spec.ts).
6. The killshot: [packages/modules/catalog/src/rls-isolation.integration.spec.ts](packages/modules/catalog/src/rls-isolation.integration.spec.ts).
7. The money: [packages/modules/pricing](packages/modules/pricing/) + [packages/modules/orders/src/checkout.service.ts](packages/modules/orders/src/checkout.service.ts).

---

## Commands

```bash
pnpm install                    # one-time
pnpm dev                        # start api with hot reload (no docker)
docker compose up --build       # full local stack
docker compose down -v          # tear down + delete data volumes
pnpm seed                       # seed 99k products + prices + promotions

pnpm nx run-many -t lint        # lint (including boundary enforcement)
pnpm nx run-many -t test        # all unit tests (integration tests skip without TEST_*_URL)
TEST_DATABASE_URL=postgres://platform:platform@localhost:5432/platform \
TEST_REDIS_URL=redis://localhost:6379 \
TEST_OPENSEARCH_URL=http://localhost:9200 \
  pnpm nx run-many -t test      # full integration tests against the docker stack
```

---

## What's deliberately not built

This is a portfolio piece, not a product. Out of scope (each documented in [docs/DECISIONS.md](docs/DECISIONS.md) and the relevant ADR):

- A storefront/back-office UI
- A real authentication module (today, `x-tenant-id` is trusted as a gateway responsibility — see [ADR-0007](docs/adr/0007-tenant-id-as-trust-gateway-responsibility.md))
- An OpenTelemetry exporter ([ADR-0008](docs/adr/0008-opentelemetry-designed-not-shipped.md))
- A microservices deployment ([ADR-0001](docs/adr/0001-modular-monolith-not-microservices.md))
- A Kubernetes cluster (manifests written, not deployed)
- Inventory / shipping / refunds / customer accounts
- Webhook-based plugin loading ([ADR-0009](docs/adr/0009-hooks-as-typed-in-process-registry.md))

If you want to discuss any of these, the ADRs explain the reasoning.

---

## License

MIT (pending — see `LICENSE` file).
