# Local Demo & API Test Handover

**Project**: e-commerce-codebase — multi-tenant headless commerce platform
**Audience**: junior team members running the system locally for the first time and exercising the REST + GraphQL APIs.
**Version**: 0.1.0

---

## 1. What you are running

A modular-monolith commerce platform with five processes orchestrated by Docker Compose:

| Service     | Port | Role                                                       |
|-------------|------|------------------------------------------------------------|
| api         | 3000 | NestJS app — REST + GraphQL surface                        |
| storefront  | 3001 | Next.js storefront — a separate deployable, own image      |
| postgres    | 5432 | Orders, tenancy, money, pricing; row-level security on     |
| redis       | 6379 | Carts, sessions, rate-limit counters                       |
| opensearch  | 9200 | Faceted product search (per-tenant indices)                |

The storefront is optional: `docker compose up api` runs the platform without it, which is the packaging claim made real — the api is a complete product on its own.

Every tenant-scoped HTTP call must send an `x-tenant-id` header. The seed creates three tenants: **t-fashion**, **t-electronics**, **t-books**.

---

## 2. Prerequisites

| Tool            | Minimum version | Notes                                                                 |
|-----------------|-----------------|-----------------------------------------------------------------------|
| Docker Desktop  | 4.x             | Must be running before any `docker compose` command                   |
| Node.js         | 22 or newer     | Only needed if you want to run `pnpm seed` from the host              |
| pnpm            | 10.34+          | `corepack enable && corepack prepare pnpm@10.34.5 --activate`         |
| Git             | any             | To clone the repo                                                     |
| Postman         | any recent      | Optional; can use Swagger UI in the browser instead                   |

---

## 3. First-time startup

Run these commands in **PowerShell** from the repo root (`c:\Work\E-Commerce\e-commerce-codebase`):

```powershell
# 1. Install JavaScript dependencies on the host (needed for the seed CLI)
pnpm install

# 2. Build images and start the full stack (detached, ~30-90s first time)
docker compose up --build -d

# 3. Wait for /health to respond 200, then seed data
#    The seed populates OpenSearch (99,000 products) and Postgres (prices,
#    promotions, tenant config) for the three demo tenants.
pnpm seed
```

When the seed finishes you should see something like:

```
seed: indexed 99,000 products in 12.5s
  bulk batch (size=500): p50=32ms p95=141ms p99=368ms max=483ms

catalog: writing attribute_definitions, products to Postgres
  t-fashion       attrs=6  products=33,000
  t-electronics   attrs=6  products=33,000
  t-books         attrs=6  products=33,000

pricing: writing tenant_config, prices, promotions to Postgres
  t-fashion       USD tax=8.75%  prices=33,000  promos=2
  t-electronics   USD tax=7.25%  prices=33,000  promos=2
  t-books         USD tax=0.00%  prices=33,000  promos=1

post-seed search: 200 random queries per tenant
  t-fashion       p50=6ms  p95=15ms  p99=26ms  avg=8.4ms
  t-electronics   p50=5ms  p95=7ms   p99=14ms  avg=5.0ms
  t-books         p50=4ms  p95=5ms   p99=6ms   avg=3.5ms
seed: done.
```

### Daily restart (data preserved)

Docker volumes survive container restarts. If you ran the seed yesterday and just want to bring the stack back up today:

```powershell
docker compose up -d
# No need to re-seed unless you ran `docker compose down -v`
```

### Wiping data (start clean)

```powershell
docker compose down -v       # drops volumes — destroys all seeded data
docker compose up --build -d
pnpm seed
```

⚠️ `down -v` is destructive. Use only when you want a fresh database.

### Smoke checks

```powershell
curl http://localhost:3000/health    # plain liveness
curl http://localhost:3000/ready     # probes Postgres + Redis + OpenSearch
```

`/ready` returns `{ "ok": true, "deps": { "postgres": "up", "redis": "up", "opensearch": "up" } }` when everything is healthy.

---

## 4. Two ways to call the APIs

You have two browser-friendly options. Pick whichever you prefer; both hit the same endpoints.

| | Swagger UI | Postman |
|---|---|---|
| Where | http://localhost:3000/docs | desktop app, import the collection |
| Best for | quick interactive exploration, sharing a URL | scripted flows, persisting variables, automated tests |
| GraphQL? | No — REST only. Use Postman or the IDE for GraphQL. | Yes |
| Setup time | None | Import collection once |

---

## 5. Using Swagger UI

### 5.1 Open it

http://localhost:3000/docs

Swagger renders all REST endpoints grouped by domain (`Health`, `Catalog (admin)`, `Pricing (admin)`, `Cart (storefront)`, `Orders`).

### 5.2 Authorize once

Click the green **Authorize** button (top right).

In the `tenantHeader` dialog, set the value to one of:

- `t-fashion`
- `t-electronics`
- `t-books`

Click **Authorize**, then **Close**. The header is now attached to every "Try it out" call automatically and survives a page reload.

### 5.3 Run a request

1. Expand a tag (e.g. **Cart (storefront)**).
2. Pick an endpoint (e.g. `POST /storefront/carts`).
3. Click **Try it out**.
4. Fill the path/body parameters if any.
5. Click **Execute**.

The response (status, headers, body, timing) renders below.

### 5.4 Important notes about Swagger here

- **GraphQL is not in Swagger.** Use the Postman collection or Insomnia/Altair for `Query.search`.
- **Request body schemas show as `{}`** for some endpoints — the DTOs are TypeScript interfaces, so Swagger has no runtime metadata. Refer to the Postman collection for accurate example bodies; you can paste them into Swagger's "Try it out" textbox.
- `/health` and `/ready` don't require the tenant header — they ignore Authorize.

---

## 6. Using Postman

### 6.1 Import the collection

1. Open Postman → **Import**.
2. Drop the file `docs/postman/e-commerce-codebase.postman_collection.json` from the repo, or browse to it.
3. The collection **e-commerce-codebase** appears in the left sidebar with folders: *Health & Readiness*, *GraphQL — Hero Search*, *Catalog (admin)*, *Pricing (admin)*, *Storefront — Cart*, *Checkout & Orders*, *Snapshot Integrity Flow*.

### 6.2 Set collection variables

Click the collection name → **Variables** tab. Defaults that ship with the collection:

| Variable    | Default                                  | Purpose                                          |
|-------------|------------------------------------------|--------------------------------------------------|
| baseUrl     | http://localhost:3000                    | Where the api is running                         |
| tenantId    | t-fashion                                | Set on `x-tenant-id` for every request            |
| productId   | a33b4b6b-84a5-49b9-8463-d4796ea805ce     | Example seeded product (a t-fashion shirt)       |
| cartId      | (empty)                                  | Auto-populated by the cart-create test script    |
| orderId     | (empty)                                  | Auto-populated by the checkout test script       |
| promotionId | (empty)                                  | Auto-populated by the promotion-create script    |

To switch tenants, change `tenantId` to `t-electronics` or `t-books`. Click **Save** after edits.

### 6.3 Sample test run 1 — Hero faceted search (GraphQL)

**Folder**: GraphQL — Hero Search → **POST /graphql — search (basic)**

**What it does**: Searches a tenant's product index for "shirt", aggregates color and size facets, returns the top 5 hits.

**Request**

- Method: `POST`
- URL: `{{baseUrl}}/graphql`
- Headers: `x-tenant-id: {{tenantId}}`, `content-type: application/json`
- Body (raw, JSON):

  ```json
  {
    "query": "query($input: SearchInput!) { search(input: $input) { total latencyMs items { id sku name attributes } facets { attribute buckets { value count } } } }",
    "variables": {
      "input": { "query": "shirt", "facets": ["color", "size"], "limit": 5 }
    }
  }
  ```

**Click Send.**

**Expected response (abbreviated)**

```json
{
  "data": {
    "search": {
      "total": 1404,
      "latencyMs": 16,
      "items": [
        {
          "id": "a33b4b6b-84a5-49b9-8463-d4796ea805ce",
          "sku": "T-FASHION-0000433",
          "name": "Awesome Shirt",
          "attributes": {
            "brand": "Nimbus", "color": "green", "size": "M",
            "price": 335.54, "in_stock": true
          }
        }
        /* ... 4 more hits ... */
      ],
      "facets": [
        { "attribute": "color", "buckets": [
            { "value": "blue", "count": 226 },
            { "value": "grey", "count": 213 }
            /* ... */
        ]},
        { "attribute": "size", "buckets": [
            { "value": "S", "count": 253 } /* ... */
        ]}
      ]
    }
  }
}
```

**What to notice**

- `total` ≈ 1400 — there are ~1400 shirts in t-fashion's index.
- `latencyMs` is what the search hero brags about. First call cold ≈ 100–300 ms (JIT warm-up). Re-run the same request: 5–15 ms.
- `facets` are aggregated over the full result set, not the page. That's the centerpiece feature.

### 6.4 Sample test run 2 — Create a cart, add an item, fetch totals

**Folder**: Storefront — Cart

**Step A — POST /storefront/carts — create**

- Method: `POST`
- URL: `{{baseUrl}}/storefront/carts`
- Body: empty
- Expected: `201 Created`, body `{ "cartId": "<uuid>" }`. The collection's test script auto-saves `cartId` into the variables.

**Step B — POST /storefront/carts/:id/items — add item**

- URL: `{{baseUrl}}/storefront/carts/{{cartId}}/items`
- Body:

  ```json
  {
    "productId": "{{productId}}",
    "sku": "T-FASHION-0000433",
    "name": "Awesome Shirt",
    "qty": 1
  }
  ```

- Expected: `201 Created`, body shows the cart with one line. (The route has no `@HttpCode` override, so Nest's POST default applies.)

**Step C — GET /storefront/carts/:id — fetch with totals**

- URL: `{{baseUrl}}/storefront/carts/{{cartId}}`
- Expected: full cart object with computed `subtotalCents`, `discountCents`, `taxCents`, `grandTotalCents` — totals are computed live each time you fetch, until checkout snapshots them.

### 6.5 Sample test run 3 — Snapshot integrity (the killer demo)

**Folder**: Snapshot Integrity Flow — run requests **1 → 5** in order.

This is the load-bearing demo of the orders module. It proves that **an order's total is frozen at checkout, immune to later catalog price changes**.

| # | Request                                                    | What it shows                                          |
|---|------------------------------------------------------------|--------------------------------------------------------|
| 1 | POST /storefront/carts                                     | Creates the cart, saves `cartId`                       |
| 2 | POST /storefront/carts/:id/items                           | Adds the example shirt                                 |
| 3 | POST /storefront/checkout                                  | Produces an order; saves `orderId` and `snapshotTotal` |
| 4 | POST /admin/prices (with `unitPriceCents: 99999999`)       | Bumps the catalog price by ~3000×                      |
| 5 | GET /admin/orders/:id                                      | Re-fetches the order — total should **not** change     |

The script on request 5 asserts `grandTotalCents` is equal to the snapshot from request 3. You should see a green test pass.

```
✓ grandTotalCents unchanged after catalog price hike
```

This is the demonstration of *order durability*: financial records do not move under your feet, even when the underlying catalog is edited.

---

## 7. Cheat-sheet: useful commands

```powershell
# Service control
docker compose up -d                  # start (or restart) the stack
docker compose stop                   # stop containers, KEEP data volumes
docker compose stop redis             # stop just one service (try with /ready)
docker compose start redis            # bring it back
docker compose down                   # stop + remove containers, KEEP volumes
docker compose down -v                # stop + remove containers AND VOLUMES (destroys data)
docker compose ps                     # what's running

# Logs
docker compose logs -f api            # follow api logs (Ctrl+C to stop)
docker compose logs --since 5m api    # last 5 minutes only

# Database — inspect data with RLS active (platform role)
docker compose exec postgres psql -U platform -d platform -c "SELECT count(*) FROM pricing.prices;"
# Same command, scoped to a tenant
docker compose exec postgres psql -U platform -d platform -c "SELECT set_config('app.tenant_id','t-fashion',false); SELECT count(*) FROM pricing.prices;"

# Database — inspect data WITHOUT RLS (postgres superuser)
docker compose exec postgres psql -U postgres -d platform -c "SELECT count(*) FROM pricing.prices;"

# Redis — peek at cart keys
docker compose exec redis redis-cli KEYS "cart:*"

# OpenSearch — see indices
curl http://localhost:9200/_cat/indices?v
```

---

## 8. Things to know before something breaks

### 8.1 The tenant header is mandatory

Every tenant-scoped request must carry `x-tenant-id: <id>`. Missing or malformed header = HTTP **400 Bad Request** (`"Missing or empty x-tenant-id header"`). The middleware is fail-closed by design.

Valid tenant id shape: `[a-zA-Z0-9._-]{1,64}`.

### 8.2 Idempotency on checkout

`POST /storefront/checkout` accepts an `idempotency-key` header (any UUID). If you POST again with the same key, you get the **same order back** (HTTP 200 on the replay vs 201 on first creation). Postman's collection auto-generates a fresh UUID per call (`{{$guid}}`), so re-running creates a new order each time. To prove idempotency, copy the key from the first response's request headers and reuse it.

### 8.3 Catalog vs search

The seed writes to both stores: 33,000 rows into `catalog.products` plus the tenant's six `catalog.attribute_definitions` in Postgres, and the same 33,000 documents into the tenant's OpenSearch index. Postgres is the canonical store; OpenSearch is the queryable projection of it.

It writes to each store directly rather than going through `POST /admin/products` — 99,000 HTTP round-trips would turn a 15-second seed into a multi-minute one. The transforms used are the same code paths the live api runs, and the Postgres writes bind `app.tenant_id` exactly as a real request does, so RLS applies to the seed as well.

If you create a product through `POST /admin/products`, it goes into Postgres and is then indexed into OpenSearch by the event-driven indexer.

### 8.4 Money is stored in integer cents

Every price/total field in the API is an integer of cents (`unitPriceCents`, `grandTotalCents`, etc.). `$199.99` is `19999`. Never use floats for money in this codebase.

### 8.5 Tenant-isolation guarantees

`pricing.prices`, `pricing.tenant_config`, `pricing.promotions`, `catalog.products`, `orders.orders`, and `audit.audit_log` all have Postgres **Row-Level Security with FORCE**. The `platform` role used by the api cannot bypass it; the RLS predicate matches `tenant_id = current_setting('app.tenant_id')`. This is the database-level guard — the application's WHERE clauses are belt-and-braces, not the primary guarantee.

A short proof:

```powershell
docker compose exec postgres psql -U platform -d platform -c "SELECT count(*) FROM pricing.prices;"
# → 0 rows (RLS hides everything when app.tenant_id is unset)

docker compose exec postgres psql -U platform -d platform -c "SELECT set_config('app.tenant_id','t-fashion',false); SELECT count(*) FROM pricing.prices;"
# → 33000 rows
```

### 8.6 Rate limiting

REST routes are rate-limited **per tenant** (200 req/min default, lower on cart/checkout). Hitting the limit returns HTTP **429 Too Many Requests**. Wait a minute or switch tenant.

### 8.7 Audit log

Every successful 2xx mutation under `/admin/*` and `/storefront/checkout` is recorded in `audit.audit_log` with the request id. Inspect via:

```powershell
docker compose exec postgres psql -U platform -d platform -c "SELECT set_config('app.tenant_id','t-fashion',false); SELECT method, path, status, request_id, created_at FROM audit.audit_log ORDER BY created_at DESC LIMIT 10;"
```

### 8.8 Request id propagation

Every response carries an `x-request-id` header. You can pass an inbound `x-request-id` and the api will reuse it. The same id appears in api logs (`docker compose logs -f api | findstr <id>`) and in the `audit_log` table — that's how you trace a single failing call end-to-end.

### 8.9 Common pitfalls

| Symptom                                                                 | Cause                                                                                                 | Fix                                                                            |
|-------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| `400 Missing or empty x-tenant-id header`                              | You opened a tenant-scoped URL in the browser without setting the header                              | Use Postman, Swagger's Authorize, or send a curl with `-H "x-tenant-id: ..."`  |
| `WebException` on curl in PowerShell                                    | `curl` is an alias for `Invoke-WebRequest` which throws on non-2xx                                    | Use `Invoke-RestMethod` instead, or `curl.exe` for true curl, or read `Error.Exception.Response` |
| `pnpm seed` says "Command 'seed' not found"                            | Top-level script is missing in `package.json`                                                         | Either run `pnpm nx run seed:run` directly, or ensure `"seed": "nx run seed:run"` is in scripts |
| `429 Too Many Requests`                                                 | Rate limit hit                                                                                        | Wait, or switch tenant                                                         |
| `/ready` returns 503                                                    | One of postgres/redis/opensearch is down                                                              | Check `docker compose ps` and `docker compose logs <service>`                  |
| GraphQL playground at `/graphql` shows 400 in the browser              | Browser GET has no tenant header                                                                      | Use Apollo Sandbox / Insomnia / Postman with the header set                    |

---

## 9. Where things live in the repo

```
apps/
  api/              the Nest application (boots everything)
  seed/             CLI that loads OpenSearch + pricing tables
packages/
  shared/           cross-cutting: db, redis, opensearch, event-bus,
                    tenant-context, hooks, security, observability, config
  modules/
    catalog/        products + attribute definitions
    search/         OpenSearch indexer + GraphQL Query.search
    pricing/        prices, tenant config, promotions, totals
    cart/           cart lifecycle (Redis-backed)
    orders/         checkout, durable orders
docs/
  ARCHITECTURE.md   module map, request lifecycle, extraction map
  RUNBOOK.md        ops tasks and common failures
  HANDOVER.md       this file
  adr/              architecture decision records (0001–0009)
  postman/          Postman collection
docker/             Postgres init scripts, etc.
```

---

## 10. Where to ask for help

- **Architecture / why something was built this way** → start with `docs/ARCHITECTURE.md` and the ADRs in `docs/adr/`.
- **Day-to-day ops** → `docs/RUNBOOK.md`.
- **Per-module mechanics** → each module has its own `README.md` (e.g. `packages/modules/orders/README.md`).
- **API call examples** → the Postman collection at `docs/postman/`.

---

*End of handover.*
