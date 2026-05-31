# shared/database

Drizzle ORM + postgres-js pool + per-module migration runner + per-request tenant binding. The data layer's load-bearing infra.

## Public surface

- Tokens: `DATABASE` (raw `postgres.Sql`), `DRIZZLE` (singleton Drizzle client), `TENANT_DRIZZLE` (request-scoped accessor), `MIGRATION_RUNNER`
- `DatabaseModule` — `@Global`; closes the pool on shutdown
- `MigrationRunner.apply(dir, schemaName)` — idempotent, transactional, checksum-tracked migration application
- `withTenantConnection(sql, tenantId, fn)` — reserves a connection, sets `app.tenant_id`, runs `fn` in ALS, RESETs the GUC before release
- `currentTenantBinding()` — read the active binding from ALS
- `TenantBindingMiddleware` — Nest middleware that wires `withTenantConnection` into the request lifecycle

## Internals

- `pool.ts` — `postgres-js` client factory
- `drizzle.ts` — Drizzle wrapper
- `migrator.ts` — per-module migration runner with per-schema `__migrations` ledger
- `tenant-binding.ts` — the load-bearing `withTenantConnection` + Proxy-backed Drizzle on reserved connection

## Tests

The migrator is exercised by every module's integration test (catalog, pricing, orders). The binding is exercised by the same.

## Why a Proxy on the reserved connection?

`postgres-js`'s `ReservedSql` doesn't expose all the static metadata Drizzle reads at construction (`options.parsers`, etc.). The Proxy returns reserved-connection methods for queries but falls back to the parent client's metadata. See [tenant-binding.ts](src/tenant-binding.ts) for the comment.

## Documented gotchas

- Drizzle's `db.transaction(...)` resolves to the *parent* `sql` client's `begin()`, which pulls a fresh pool connection — without `app.tenant_id`, so RLS blocks every insert. Use manual `BEGIN`/`COMMIT` on `currentTenantBinding().reserved` instead. See `packages/modules/orders/src/checkout.service.ts` for the pattern.
