# shared/redis

ioredis client + per-tenant namespaced wrapper. Used by the cart module today.

## Public surface

- `createRedisClient(url)` — ioredis factory
- `TenantRedisClient.forTenant(tenantId)` → `TenantRedis`
- `TenantRedis.{get, set, del, exists}` — every key auto-prefixed `t:<tenant>:*`
- `RedisModule` — `@Global`; quits the client on shutdown
- Tokens: `REDIS`, `TENANT_REDIS`

## The invariant

`TenantRedis` namespaces every key by tenant id at construction. Cross-tenant key access is impossible by construction — same shape as `TenantSearchClient` (OS) and `TENANT_DRIZZLE` (Postgres binding).

Tenant id is regex-validated at `forTenant()` time, matching `TenantMiddleware`'s shape check, so a malformed id can't slip in through a non-HTTP code path (e.g. a worker).

## Caveats

Redis doesn't have transactional semantics across keys the way Postgres does. The wrapper deliberately doesn't paper over that — callers needing atomicity across multiple keys go to the underlying ioredis client via the `REDIS` token. The cart's read-modify-write is single-key JSON, so this constraint doesn't bite for step 5.

## Used by

- `packages/modules/cart` — `cart:<cartId>` JSON with 24h TTL
