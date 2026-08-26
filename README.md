# e-commerce-codebase

[![ci](https://github.com/rohansharma141/e-commerce-codebase/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rohansharma141/e-commerce-codebase/actions/workflows/ci.yml)

![Storefront browse — faceted search across 33,000 products](docs/screenshots/storefront-browse.png)

<sub>Faceted browse over one tenant's 33,000 products. Facet counts are computed across the whole result set rather than the returned page, and the timing beside the product count is the api's own measurement of that query.</sub>

Enterprise commerce platform: multi-tenant, headless, API-first. Built from scratch as a portfolio piece demonstrating platform-architecture capability. **Depth over breadth** — a hero feature that sings on a clean spine, with a sharp architecture story.

**Stack**: Node.js + TypeScript, NestJS, PostgreSQL (orders/tenancy/money), OpenSearch (search), Redis (cart/sessions), Drizzle ORM, GraphQL (storefront reads) + REST (admin/system), pnpm + Nx monorepo.

**Hero feature**: faceted search-at-scale on tenant-defined typed attributes, with per-tenant physical isolation in OpenSearch and Postgres RLS killing cross-tenant access at the database layer.

---

## Running it

**Prerequisites**

| | |
|---|---|
| Docker Desktop | running before any `docker compose` command |
| Node **22** | the version in `.nvmrc`. Newer majors are rejected at install time — pnpm 9.12 crashes on Node 24, so `engines` pins the range rather than letting it fail obscurely |
| pnpm 9.12 | `corepack enable && corepack prepare pnpm@9.12.0 --activate` |

Node and pnpm are needed only for the seed and for running things outside Docker. The stack itself needs Docker alone.

```bash
git clone https://github.com/rohansharma141/e-commerce-codebase
cd e-commerce-codebase

docker compose up --build -d   # first build ~6 min (two images: api + storefront);
                               # subsequent starts are seconds. -d so you keep the shell
pnpm install                   # installs the monorepo
pnpm seed                      # ~30s; 99k products + prices + promotions across 3 tenants

# Optional: route a 25-product slice per tenant through the real HTTP write
# path instead of straight into the stores, so a broken admin endpoint fails
# the seed instead of going unnoticed. Same totals either way.
SEED_VIA_API=1 pnpm seed
```

The seed is not optional if you intend to try the verifications below — two of the three read as passing but prove nothing against an empty database.

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

A Next.js storefront ships alongside the api as a separately-deployable artifact, and `docker compose up` already started it. Open:

`http://t-fashion.localhost:3001/` — or `t-electronics`, `t-books`. Modern browsers resolve `*.localhost` natively, so no `/etc/hosts` edits.

![The same code serving a second tenant with its own theme](docs/screenshots/storefront-tenant-theme.png)

<sub>The same routes and the same build, serving a different tenant — including a dark theme. Brand name, colours, typography, page foreground and catalogue all come from the api at request time; there is no per-tenant fork and no theme-specific CSS.</sub>

To prove the api ships without it, start the api alone: `docker compose up api`.

For hot reload while working on the storefront, stop the container first and run it from source — otherwise both want port 3001:

```bash
docker compose stop storefront
pnpm nx serve storefront
```

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

![RLS killshot — 0 unbound, 33,000 bound, 99,002 via superuser bypass](docs/screenshots/rls-killshot.png)

Expect `0`, then `33000`, then `99002`. **If all three come back `0`, the seed hasn't run** — every count is zero against an empty table, so the comparison demonstrates nothing. That is the failure mode to watch for, because it looks exactly like a pass.

The same shape works on `orders.orders` and `pricing.*`. See [ADR-0003](docs/adr/0003-rls-not-where-only.md) for why this is the load-bearing test.

### 3. Snapshot integrity — historical orders never mutate when live config changes

Place an order, then move the promotion out from under it. Copy-paste in order:

```bash
H='-H content-type:application/json -H x-tenant-id:t-fashion'

# 1. pick any seeded product
read -r PID SKU <<< $(curl -s -X POST http://localhost:3000/graphql $H \
  -d '{"query":"query{search(input:{limit:1}){items{id sku}}}"}' \
  | python -c "import sys,json;i=json.load(sys.stdin)['data']['search']['items'][0];print(i['id'],i['sku'])")

# 2. create a cart, add two of it
CART=$(curl -s -X POST http://localhost:3000/storefront/carts $H \
  | python -c "import sys,json;print(json.load(sys.stdin)['cartId'])")
curl -s -X POST "http://localhost:3000/storefront/carts/$CART/items" $H \
  -d "{\"productId\":\"$PID\",\"sku\":\"$SKU\",\"name\":\"demo\",\"qty\":2}" > /dev/null

# 3. apply the seeded 25% coupon, then check out
curl -s -X POST "http://localhost:3000/storefront/carts/$CART/coupon" $H \
  -d '{"code":"SPRING25"}' > /dev/null
ORDER=$(curl -s -X POST http://localhost:3000/storefront/checkout $H \
  -H "idempotency-key: $(python -c 'import uuid;print(uuid.uuid4())')" \
  -d "{\"cartId\":\"$CART\"}")
echo "$ORDER" | python -m json.tool | grep -E 'grandTotalCents|discountCents|actionValue'

# 4. change that promotion from 25% to 90%
PROMO=$(echo "$ORDER" | python -c "import sys,json;print(json.load(sys.stdin)['appliedPromotion']['promotionId'])")
ORDER_ID=$(echo "$ORDER" | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s -X PATCH "http://localhost:3000/admin/promotions/$PROMO" $H \
  -d '{"action":{"type":"percent","value":9000}}' > /dev/null

# 5. re-fetch the order — every number is identical
curl -s "http://localhost:3000/admin/orders/$ORDER_ID" $H \
  | python -m json.tool | grep -E 'grandTotalCents|discountCents|actionValue'
```

The order still reports the 2500 bps it was placed under, the same discount and the same total, while the live promotion now reads 9000. Price, promotion terms and tax rate are all copied into the order at checkout, so editing catalog or pricing data afterwards cannot rewrite financial history.

---

## Architecture

Modular monolith, not microservices. Three disciplines preserve a clean future split:

1. **No cross-module SQL joins, ever.** Every module owns its own Postgres schema (`catalog`, `pricing`, `orders`, `audit`).
2. **Events are network-strict** — plain serializable objects, idempotent consumers, `structuredClone` on dispatch.
3. **No cross-module `src/` imports** — ESLint `@nx/enforce-module-boundaries` enforces this at build time.

```
apps/
  api/                  the backend deployable
  storefront/           the Next.js deployable — separate image, ships alone
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
    branding/           per-tenant storefront theme
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

# Full integration tests against the docker stack.
# ⚠️ These DROP and rebuild the catalog, pricing and orders schemas to get a
#    clean slate — your seeded data does not survive. Re-run `pnpm seed`
#    afterwards before demoing anything.
TEST_DATABASE_URL=postgres://platform:platform@localhost:5432/platform \
TEST_REDIS_URL=redis://localhost:6379 \
TEST_OPENSEARCH_URL=http://localhost:9200 \
  pnpm nx run-many -t test

# Storefront ↔ API contract conformance. Wants a SEEDED api, so run it after
# re-seeding — not in the same invocation as the suites above.
pnpm seed
TEST_API_URL=http://localhost:3000 pnpm nx test storefront
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

MIT — see [LICENSE](LICENSE).
