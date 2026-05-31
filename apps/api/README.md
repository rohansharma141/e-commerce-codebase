# apps/api

The single deployable. NestJS process that hosts every module. Listens on `:3000`.

## What it does

- Reads + validates env via `shared/config` (zod schema)
- Bootstraps pino logging with `genReqId` propagation
- Applies `helmet` security headers
- Wires every module: shared/* + catalog + search + pricing + cart + orders
- Registers tenant middleware chain: `TenantMiddleware` → `TenantBindingMiddleware`
- Exposes `/health` (liveness), `/ready` (deps health), REST admin/storefront routes, and GraphQL at `/graphql`
- Applies all per-module migrations on boot (via each module's `onModuleInit`)
- Registers demo hooks (`apps/api/src/demo-hooks.module.ts`) so the customisation pattern is observable in logs

## Boot order

1. Express + Nest factory
2. Helmet middleware on the underlying Express app
3. Global ValidationPipe (whitelist:false — needed for GraphQL @Args)
4. GraphQL Module (Apollo driver)
5. Each module's `onModuleInit` runs its migrations: catalog → pricing → orders → audit (order doesn't matter functionally; logged for verifiability)
6. `app.listen(PORT)`

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness only |
| GET | `/ready` | Deps probe (Postgres + Redis + OpenSearch) |
| POST | `/graphql` | Storefront search |
| PUT/GET | `/admin/tenant-config` | Money config per tenant |
| POST/GET | `/admin/prices` | Price upsert/list |
| POST/GET/PATCH | `/admin/promotions` | Promotion CRUD |
| POST/GET | `/admin/attribute-definitions` | Attribute definitions |
| POST/GET/PATCH/DELETE | `/admin/products` | Product CRUD |
| GET | `/admin/orders` | Orders list |
| GET | `/admin/orders/:id` | Order detail |
| POST | `/storefront/carts` | Create cart |
| GET | `/storefront/carts/:id` | Cart with totals |
| POST | `/storefront/carts/:id/items` | Add line |
| PATCH | `/storefront/carts/:id/items/:productId` | Set qty (0=remove) |
| POST/DELETE | `/storefront/carts/:id/coupon` | Coupon |
| POST | `/storefront/checkout` | Cart → order; respects `Idempotency-Key` |

## Notable env vars

| Var | Required | Default |
|---|---|---|
| `DATABASE_URL` | yes | — |
| `REDIS_URL` | yes | — |
| `OPENSEARCH_URL` | yes | — |
| `PORT` | no | 3000 |
| `NODE_ENV` | no | development |
| `LOG_LEVEL` | no | info |
| `SKIP_MIGRATIONS` | no | unset (set to `1` in tests to skip the auto-migration) |

## Build / run

```bash
pnpm nx serve api         # dev mode (no docker; needs Postgres/Redis/OS reachable)
pnpm nx build api         # webpack bundle to dist/apps/api
docker compose up --build # full stack including this api
```

## Tests

The api itself has just the health controller test. The integration tests live in the modules (catalog, search, orders). The api's role is composition; the modules carry the test surface.
