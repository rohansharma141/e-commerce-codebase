# Architecture

## TL;DR

Modular monolith. Two deployables that ship separately (`apps/api` and `apps/storefront`), the second optional. Tenant isolation is enforced *physically* at every storage layer: per-tenant OpenSearch indices, per-tenant Postgres RLS, per-tenant Redis key namespaces. Modules talk via in-process events and contract-defined service tokens. Cross-module `src/` imports are blocked by ESLint at build time.

## Dependency map

```
                         ┌────────────────────┐
                 ┌──────►│   apps/api         │  (composition root)
                 │       └────────┬───────────┘
                 │                │ wires every module
                 │  ┌─────────────┴─────────────┐
                 │  │                           │
        ┌────────▼──▼──────┐         ┌──────────▼────────┐
        │ modules/catalog  │         │  modules/search   │
        │  catalog schema  │ events  │  per-tenant       │
        │  attribute_defs  ├────────►│  OpenSearch       │
        │  products        │         │  indices          │
        └─────────┬────────┘         └──────────┬────────┘
                  │                              │ GraphQL Query.search
                  │ events                       ▼
                  │                       storefront read edge
                  ▼
        ┌──────────────────┐         ┌───────────────────┐
        │ modules/pricing  │◄────────│  modules/cart     │
        │ pricing schema   │ totals  │  Redis-backed     │
        │  tenant_config   │         │  TenantRedis      │
        │  prices          │         └─────────┬─────────┘
        │  promotions      │                   │
        └────────┬─────────┘                   │ CART_SERVICE
                 │                             ▼
                 │ PRICES/PROMO/CFG  ┌───────────────────┐
                 └──────────────────►│  modules/orders   │
                                     │  orders schema    │
                                     │  + idempotency    │
                                     │  + snapshot       │
                                     └────────┬──────────┘
                                              │ orders.created
                                              ▼
                                      future subscribers
                                      (analytics, email, …)

        ┌──────────────────┐
        │ modules/branding │  branding schema, one row per tenant.
        │  Query.theme     │  Extracted out of pricing; the storefront
        └──────────────────┘  reads it per request to skin itself.

  apps/api also owns what no single module can:
    Query.capabilities + GET /system/capabilities  (what this deployment
      supports for this tenant: currency, minor units, locale, tax, features)
    storefront-webhook dispatcher + outbox worker  (see Event topology)

  apps/storefront — separate deployable, separate image. Imports ONLY
    packages/api-client and talks to the api over its public schema. It is a
    consumer like any other; nothing in the api knows it exists beyond an
    optional revalidate URL.

  shared/ libs (used by everything):
    config (zod env) │ database (Drizzle + per-request tenant binding + RLS)
    event-bus        │ hooks (extension-point registry)
    observability    │ opensearch (per-tenant index handles)
    redis            │ security (helmet + throttler + audit log)
    tenant-context   │ (ALS-bound tenant + requestId + middleware)
```

## Storage layers — tenant isolation at each one

| Layer | Mechanism | Test |
|---|---|---|
| Postgres (catalog, pricing, orders, audit) | Row-level security with `FORCE RLS`. `app.tenant_id` set per request on a reserved pooled connection. | [rls-isolation.integration.spec.ts](../packages/modules/catalog/src/rls-isolation.integration.spec.ts) — including the killshot: unbound session returns 0 rows. |
| OpenSearch (search) | Index-per-tenant (`products-<tenant>`). `TenantSearchClient.forTenant()` returns a handle bound to ONE index by construction; no cross-tenant API surface. | [search.integration.spec.ts](../packages/modules/search/src/search.integration.spec.ts) — physical isolation, mapping evolution scoped per tenant. |
| Redis (cart) | Tenant-prefixed keys (`t:<tenant>:cart:<cartId>`). `TenantRedisClient.forTenant()` rejects unsafe tenant ids at boot. | Exercised by [checkout.integration.spec.ts](../apps/api/src/checkout.integration.spec.ts). |
| Postgres (`branding`) | Same `FORCE RLS` shape. One row per tenant, theme as jsonb. | Killshot verified: unbound 0 rows, bound 1. |
| Postgres (`audit.webhook_outbox`) | `FORCE RLS`, but the policy also admits a session that sets `app.system_worker` — the delivery worker legitimately spans tenants, and every table that could tell it which tenants have work is itself RLS-protected. Chosen over running the worker as a BYPASSRLS superuser, which would grant one connection the whole database instead of one table. | Fails closed: with neither GUC set, an unbound session sees 0 rows. |

The platform's `platform` Postgres role is non-superuser, non-bypassrls (see [docker/postgres/init/01-platform-role.sql](../docker/postgres/init/01-platform-role.sql)) — this is what makes `FORCE RLS` actually bite. The image-default `postgres` superuser exists for migrations and admin only.

## The request lifecycle (catalog write example)

```
  POST /admin/products
      │
      ▼
  ┌──────────────────────────────────────────────────────────┐
  │  pino genReqId(req) ─ reads x-request-id or generates    │
  │  helmet ─ standard security headers                      │
  │  ThrottlerGuard ─ rate-limit by tenant id                │
  └──────────────────────────────────────────────────────────┘
      │
      ▼  (Nest middleware chain)
  ┌──────────────────────────────────────────────────────────┐
  │  TenantMiddleware                                        │
  │    - validates x-tenant-id shape (regex)                 │
  │    - resolves requestId (header or new uuid)             │
  │    - runWithTenant(ctx, next)                            │
  │      └─► ALS: { tenantId, requestId } now in scope       │
  │  TenantBindingMiddleware                                 │
  │    - sql.reserve() → reserved pg connection              │
  │    - SET app.tenant_id = <tenantId>                      │
  │    - runs next() inside binding ALS scope                │
  │    - RESET on response close                             │
  └──────────────────────────────────────────────────────────┘
      │
      ▼  (Nest interceptors)
  ┌──────────────────────────────────────────────────────────┐
  │  AuditLogInterceptor ─ records mutation to audit.audit_log│
  │  (after successful 2xx response)                          │
  └──────────────────────────────────────────────────────────┘
      │
      ▼
  ┌──────────────────────────────────────────────────────────┐
  │  ProductsController.create                               │
  │    → ProductsService.create                              │
  │      → AttributeValidator.validate (with the tenant's    │
  │        attribute_definitions, RLS-scoped)                │
  │      → ProductsRepository.insert (RLS-scoped insert)     │
  │      → EventBus.publish(catalog.product.created)         │
  │        → ProductIndexerService (in same process)         │
  │          → TenantSearchClient.forTenant(t).indexDoc      │
  │      → HookRegistry.dispatch(product.after-create)       │
  └──────────────────────────────────────────────────────────┘
      │
      ▼
  201 Created with x-request-id echoed back
```

The same chain handles `/storefront/checkout` — adding the transactional core: `BEGIN` on the reserved connection, conditional promo consumption (`WHERE uses_count < max_uses`), snapshot inserts into `orders.order_lines` + `orders.order_promotion_snapshot`, `COMMIT`, post-commit cart delete, `orders.created` event publish.

## Events vs hooks

Both ride the same in-process delivery mechanism today, but they are conceptually different:

- **Events** are fan-out notifications. Many subscribers, one publish, network-strict (`structuredClone` on dispatch, no shared references), idempotent consumers (the bus may redeliver). Cross-module by design — the search indexer subscribes to catalog events without knowing who else does.
- **Hooks** are a *named* extension-point API the platform publishes. The set is finite and documented (`HOOK_NAMES` in `packages/shared/hooks`). Today these are observer-only; mutating hooks are documented in [ADR-0009](adr/0009-hooks-as-typed-in-process-registry.md).

## Event topology — and why invalidation follows the read model

```
  POST /admin/prices
      │
      ▼  pricing.price.upserted            (pricing publishes after commit)
      ├──────────────► search indexer      patches attr_price on the product
      │                                    document, refresh: 'wait_for'
      │                                         │
      │                                         ▼  search.product.indexed
      │                                            (published only once the
      │                                             write is READABLE)
      │                                                 │
      │                                                 ▼
      │                                    storefront-webhook dispatcher
      │                                         writes audit.webhook_outbox
      │                                                 │
      │                                                 ▼  polling worker
      │                                    POST /api/revalidate → revalidateTag
      └──────────────► (any future subscriber)
```

Two decisions in that chain are load-bearing and were both learned the hard way.

**Cache invalidation keys off `search.product.indexed`, not the domain event
that caused it.** `EventBus.publish` delivers to every subscriber concurrently
and awaits none of them, so subscribing the webhook dispatcher directly to
`catalog.product.updated` raced the indexer. When the dispatcher won, the
storefront dropped its cached page and immediately rebuilt it from an index
that had not changed yet — re-caching the stale render until the one-hour
backstop. The symptom is an edit that appears not to have worked. Publishing
only after the write is readable removes the race by construction.

**Delivery is a transactional outbox, not an inline POST.** The subscriber's
job ends at "this is durably recorded as owed"; a polling worker delivers with
exponential backoff, then a bounded dead-letter sweep re-drives exhausted rows
three times before leaving them. Polling rather than triggering on the enqueue
is deliberate: a row written by a request that later rolls back must never be
delivered, and rows stranded by a dead process must be picked up by whatever is
running now. Polling makes both the same case.

The api never learns the storefront's cache topology — payloads are
event-shaped, and the storefront decides which tags an event invalidates.

## Extraction map — which modules would split first?

If we ever went to microservices (note: [ADR-0001](adr/0001-modular-monolith-not-microservices.md) argues we shouldn't until the platform forces our hand), this is the order:

1. **Search** first. Query volume scales independently and read-side traffic is async-friendly. Already isolated (separate per-tenant indices). Pull out behind a GraphQL gateway.
2. **Catalog** next. Admin write-side concerns own their own team typically. Module already has its own schema; events cross the wire naturally.
3. **Orders + Pricing stay bundled** because they need to be transactionally atomic. Splitting them turns checkout into a saga, which is the [D-08 trap](DECISIONS.md#d-08-microservices-documented-not-built).
4. **Cart** can move whenever you decide carts deserve their own SLO. The Redis store is already isolated.

What makes this easy: every module already owns its schema/index/keyspace, every cross-module dependency is via contracts + tokens, and every event is already network-strict in shape.

## What the load-bearing tests prove

| Test | Proves |
|---|---|
| [rls-isolation.integration.spec.ts](../packages/modules/catalog/src/rls-isolation.integration.spec.ts) | RLS is the actual guard, not the WHERE clauses. Killshot: unbound session sees 0 rows. |
| [search.integration.spec.ts](../packages/modules/search/src/search.integration.spec.ts) | Per-tenant indices; mapping evolution doesn't touch other tenants; redelivery is idempotent. |
| [checkout.integration.spec.ts](../apps/api/src/checkout.integration.spec.ts) | Idempotency-Key short-circuits; concurrent checkouts on max_uses=1 promo: one wins, one falls back; live promo edits don't mutate historical orders. |
| [contract.integration.spec.ts](../apps/storefront/src/contract.integration.spec.ts) | The public surface actually returns what the storefront reads. Issues every operation the storefront uses against a live api and asserts the *exact* key set of `Cart` and `Order`, so a drifted hand-mirrored type fails loudly. The lint boundary proves nothing was imported across the line; this proves the line is wide enough. |
| [totals-calculator.spec.ts](../packages/modules/pricing/src/totals/totals-calculator.spec.ts) + [money-ops.spec.ts](../packages/modules/pricing/src/totals/money-ops.spec.ts) + [promotion-selector.spec.ts](../packages/modules/pricing/src/promotions/promotion-selector.spec.ts) | Money math is integer-cents end-to-end, banker's-rounded, best-single stacking is deterministic and tie-broken by id. |

## Further reading

- [DECISIONS.md](DECISIONS.md) — the reasoning behind every architectural call.
- [adr/](adr/) — formal records of the calls a reviewer should be able to interrogate independently.
- [RUNBOOK.md](RUNBOOK.md) — common operational tasks (seed sizing, debugging, etc.).
- [../CLAUDE.md](../CLAUDE.md) — the operational rules.
