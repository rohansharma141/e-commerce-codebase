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

## Things that will bite you

Learned by being bitten. Each of these produced a confusing symptom whose cause was several steps upstream.

**Running the test suite empties the demo data.** The module integration suites `DROP SCHEMA` for catalog, pricing and orders to get a clean slate. A green suite followed by a storefront showing no products is both working exactly as designed. Re-run `pnpm seed` afterwards.

**The storefront conformance suite wants the opposite.** It needs a *seeded* api, so it cannot share an invocation with the module suites. Order: module suites → `pnpm seed` → `TEST_API_URL=http://localhost:3000 pnpm nx test storefront`.

**Migrations are verified only on an empty database.** The ledger records what has been applied, so a machine that has run them before never re-runs the failing path. Before pushing anything with a migration, `docker compose down -v`, bring the stack up, and watch all five schemas migrate from nothing.

**A migration checksum mismatch on a file you did not touch is line endings.** The runner hashes file bytes to enforce immutability. `.gitattributes` pins text to LF for exactly this reason; if it reappears, check what `git config core.autocrlf` did to the working tree.

**`pnpm` refuses to run on Node 24.** `engines` pins `>=22 <23` because pnpm 9.12 crashes on 24. That is deliberate — use Node 22. To work around it locally for a single command, prefix with `npm_config_engine_strict=false`.

**Do not call nx directly.** `node node_modules/nx/bin/nx.js` loses the environment `pnpm nx` sets up and produces a spurious `Cannot find module 'next/babel'` lint error that looks like a real regression.

**The storefront container does not come back after a Docker restart.** No `restart:` policy in compose. `docker compose ps` before demoing; `docker compose up -d storefront` if it is missing.

**Webhook timings in compose are demo settings.** `STOREFRONT_WEBHOOK_MAX_ATTEMPTS=2` and `STOREFRONT_OUTBOX_SWEEP_MS=15000` make the give-up and dead-letter sweep observable within a minute. Production defaults are 6 attempts and a 60s sweep.

## Inspecting webhook delivery

The outbox is the record of what the storefront was told and whether it heard.

```powershell
# pending, failed and dead-lettered deliveries (system worker sees all tenants)
docker compose exec postgres psql -U platform -d platform -c "SELECT set_config('app.system_worker','on',false); SELECT event, attempts, requeues, exhausted, delivered_at IS NOT NULL AS done, left(last_error,60) FROM audit.webhook_outbox ORDER BY created_at DESC LIMIT 10;"

# anything that gave up for good
docker compose exec postgres psql -U platform -d platform -c "SELECT set_config('app.system_worker','on',false); SELECT count(*) FROM audit.webhook_outbox WHERE exhausted;"
```

A row with `exhausted = true` and `requeues = 3` has been given up on permanently; its `last_error` says why.

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
