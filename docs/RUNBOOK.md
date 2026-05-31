# Runbook

Common tasks, common failures, common fixes.

## Bringing the stack up from zero

```bash
docker compose up --build       # postgres + redis + opensearch + api
pnpm install                    # one-time
pnpm seed                       # populates 99k products + prices + promos
```

Check the api is alive:

```bash
curl localhost:3000/health      # liveness — should return {status:"ok",...}
curl localhost:3000/ready       # readiness — probes all three deps
```

## Seeding

| Variable | Default | Purpose |
|---|---|---|
| `SEED_PRODUCTS_PER_TENANT` | `33000` | Products generated per tenant. 33k × 3 ≈ 99k. |
| `SEED_BULK_SIZE` | `500` | OpenSearch bulk-index batch size. |
| `SEED_SEARCH_SAMPLES` | `200` | Number of post-seed search queries used to derive the p50/p95/p99 numbers. |
| `OPENSEARCH_URL` | `http://localhost:9200` | OpenSearch endpoint. |
| `DATABASE_URL` | `postgres://platform:platform@localhost:5432/platform` | Postgres endpoint. |

Quick smoke seed (loads faster):

```bash
SEED_PRODUCTS_PER_TENANT=3000 pnpm seed
```

## Common errors

### `relation "audit.__migrations" does not exist`

A previous run created the schema but the table was dropped manually. The migrator creates it on demand; just re-boot the api.

### `helmet` headers not appearing on `curl`

`-I` only shows headers; on some versions you need `-D-` or `-i` to see them on the response. The first request after boot also sometimes lacks rate-limit headers because the throttler hasn't received its first hit.

### OpenSearch returns 503 on `/_cluster/health?wait_for_status=yellow`

The single-node OS cluster needs a few seconds to settle after `docker compose up`. The api retries during boot; `/ready` reports `opensearch: down` until it's ready. Wait or restart the api container.

### `pg_authid` permission denied for `platform`

The `platform` role is intentionally non-superuser (this is what makes RLS bite). Query system catalogs as `postgres` (the docker-image default superuser):

```bash
docker exec e-commerce-codebase-postgres-1 psql -U postgres -d platform -c "SELECT ..."
```

### `db.transaction` fails RLS

If you ever see `new row violates row-level security policy` during a write, you're probably opening a transaction on the singleton drizzle client instead of the request-scoped one. See `packages/modules/orders/src/checkout.service.ts` — it issues BEGIN/COMMIT manually on the request's reserved connection via `currentTenantBinding()`.

### `seed: failed connect ECONNREFUSED`

The seed CLI assumes the docker stack is up. Run `docker compose up -d` first, or set `OPENSEARCH_URL` / `DATABASE_URL` to wherever your services are listening.

## Manually inspecting per-tenant data

All tenant-scoped tables use Postgres RLS. To inspect from psql, set the GUC first:

```sql
SET app.tenant_id = 't-fashion';
SELECT count(*) FROM orders.orders;            -- only t-fashion's orders
SELECT count(*) FROM catalog.products;
SELECT count(*) FROM pricing.promotions;
SELECT * FROM audit.audit_log ORDER BY created_at DESC LIMIT 10;
```

`RESET app.tenant_id` (or starting a new session) clears the binding — and then all tenant-scoped queries return zero rows by design.

## Resetting between runs

```bash
docker compose down -v          # WIPES all data volumes
docker compose up --build
pnpm seed
```

If you only want to wipe Postgres but keep OpenSearch:

```bash
docker exec e-commerce-codebase-postgres-1 \
  psql -U postgres -d platform \
  -c "DROP SCHEMA catalog CASCADE; DROP SCHEMA pricing CASCADE; DROP SCHEMA orders CASCADE; DROP SCHEMA audit CASCADE;"
docker compose restart api
```

The api re-applies all migrations on boot.

## Logs

The api uses structured JSON logging via pino. Key fields:

- `req.id` — request id, also returned to clients as `x-request-id`
- `context` — Nest logger context (`CheckoutService`, `ProductIndexerService`, `demo-hook`, …)
- `msg` — message
- `level` — 30 = info, 50 = error

Grep is your friend:

```bash
docker logs e-commerce-codebase-api-1 | grep '"context":"CheckoutService"'
docker logs e-commerce-codebase-api-1 | grep '"req":{"id":"<request-id>"'
```

## Reseting OpenSearch indices only

```bash
curl -X DELETE http://localhost:9200/products-t-fashion
curl -X DELETE http://localhost:9200/products-t-electronics
curl -X DELETE http://localhost:9200/products-t-books
# The api recreates them when the seed runs (or when the indexer sees an event).
```
