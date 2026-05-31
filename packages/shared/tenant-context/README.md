# shared/tenant-context

AsyncLocalStorage-backed tenant context. Every tenant-scoped operation reads tenant + requestId from ALS via `currentTenant()`.

## Public surface

- `TenantContext = { tenantId, requestId, userId? }`
- `runWithTenant(ctx, fn)` — enters an ALS scope
- `currentTenant()` / `currentTenantOrThrow()` — reads the active scope
- `CurrentTenant()` — Nest param decorator for controllers
- `TenantMiddleware` — validates `x-tenant-id` shape, resolves `x-request-id`, binds ALS
- `TenantContextModule`

## Header validation

Tenant id must match `/^[a-zA-Z0-9._-]{1,64}$/` — same regex used by `TenantRedisClient` and the OpenSearch index name slugifier. Rejects malformed values at the api edge before they reach any storage layer.

## Why ALS over per-request Nest scope?

Nest's request-scoped providers add construction overhead per request (DI graph traversal). ALS has near-zero per-request cost; the tenant binding survives across `await` points in user code without any explicit threading. This matters because every catalog/pricing/order code path reads `currentTenant()` — frequency is high enough that overhead would compound.

## Tests

- `tenant-context.spec.ts` — ALS scoping, concurrent flow isolation, throw outside scope; middleware validation (presence, regex), requestId handling
