# ADR-0003: Postgres RLS as the enforcement backstop, not WHERE-only

**Status:** Accepted
**Date:** 2026-05-29

## Context

The platform is multi-tenant. Every catalog/pricing/order row carries `tenant_id`. The naïve approach — every repository hand-writes `WHERE tenant_id = $current_tenant` — works *until* the first code path that forgets the clause, or the first developer who drops to raw SQL, or the first new module wired without the discipline. The cost of one bug is a cross-tenant data leak.

We need a guard that can't be bypassed by forgetting an app-layer convention.

## Decision

Enable **Postgres row-level security with `FORCE`** on every tenant-scoped table. Policies use `current_setting('app.tenant_id', true)`. The api binds the tenant on a **reserved pooled connection** per request via `set_config('app.tenant_id', <tenant>, false)`; the connection is RESET before release so the GUC never leaks back into the pool.

The application-layer `WHERE tenant_id = ...` clauses are kept — they catch a binding misconfiguration (sees zero rows) before the database has to (also sees zero rows). Defense in depth.

Two roles in Postgres:

- **`postgres`** (the docker image's default superuser): used for initial DDL only. Bypasses RLS.
- **`platform`** (the runtime + migration role): non-superuser, `NOBYPASSRLS`. `FORCE RLS` ensures even the table-owner identity is subject to policies.

## Consequences

- A forgotten WHERE clause is no longer a security incident — it returns zero rows because RLS independently blocks it.
- Direct psql access from operations staff requires `SET app.tenant_id` before any tenant-scoped query — which is the right user experience: "you should know which tenant you're touching."
- The migrator runs as `platform` and DDL doesn't go through RLS, so schema changes work normally. DML in future migrations (data backfills) will need `SET app.tenant_id` per tenant in a loop or a privilege escalation.
- The killshot test — unbound session sees 0 rows even though rows exist — is the load-bearing demonstration that this works. See [rls-isolation.integration.spec.ts](../../packages/modules/catalog/src/rls-isolation.integration.spec.ts).
- Pool-connection reservation per request is a real cost (one connection slot held for the request lifetime). At demo scale this is invisible; at production scale we'd want `pgbouncer` in front and tune connection pool sizing.

## Alternatives considered

**WHERE-only enforcement.** Rejected. One missed clause is too easy and too costly. The discipline doesn't survive contact with team growth.

**Per-tenant database.** Strongest isolation, but doesn't scale past a few hundred tenants (connection-pool overhead × tenants), and onboarding a new tenant becomes provisioning rather than INSERT. Probably right for very-large-customer B2B platforms; over-engineered for the architecture demonstration.

**Schema-per-tenant.** Half-measure. Same overhead concerns as per-tenant database, but with less isolation guarantees. Worst of both worlds.

**Connection-pinning via PgBouncer session mode + a custom auth method that injects the GUC.** The "production grown-up" version of what we do today. Documented as the operational evolution; not in scope for the demo.

## Links

- [packages/modules/catalog/src/db/migrations/0002_rls.sql](../../packages/modules/catalog/src/db/migrations/0002_rls.sql)
- [packages/modules/pricing/src/db/migrations/0002_rls.sql](../../packages/modules/pricing/src/db/migrations/0002_rls.sql)
- [packages/modules/orders/src/db/migrations/0002_rls.sql](../../packages/modules/orders/src/db/migrations/0002_rls.sql)
- [packages/shared/database/src/tenant-binding.ts](../../packages/shared/database/src/tenant-binding.ts) — the `withTenantConnection` helper
- [packages/shared/database/src/tenant-binding.middleware.ts](../../packages/shared/database/src/tenant-binding.middleware.ts) — per-request wiring
- [docker/postgres/init/01-platform-role.sql](../../docker/postgres/init/01-platform-role.sql) — non-superuser role setup
- **Killshot test:** [packages/modules/catalog/src/rls-isolation.integration.spec.ts](../../packages/modules/catalog/src/rls-isolation.integration.spec.ts)
