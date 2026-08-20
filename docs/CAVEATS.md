# Known caveats and follow-ups

The honest list. Things this platform doesn't do today, edges where it makes a trade-off worth knowing about, and the concrete path to fix each. Organized by area.

Every item has a **status**: *by design* (intentional, see linked ADR), *scoped out* (out of CLAUDE.md scope today), or *open* (real gap, has a fix path).

---

## Storefront

### Webhook revalidation is fire-and-forget
- **Status:** open with a fallback.
- **What:** [storefront-webhook.module.ts](../apps/api/src/storefront-webhook.module.ts) POSTs to the storefront with a 5s timeout. A failed POST is logged but not retried.
- **Impact:** if the storefront's `/api/revalidate` is briefly unreachable when a catalog event fires, the affected page stays stale until the 1-hour `revalidate` fallback (set in `api-graphql.ts`).
- **Fix path:** persistent outbox table on the api side (`audit.webhook_outbox`), a periodic worker that retries with exponential backoff, idempotency on the storefront side keyed by `eventId`. The outbox pattern is also what unlocks moving to a real broker later (ADR-0001).

### Cache tags are coarse for browse pages
- **Status:** open.
- **What:** every browse / category page renders with one tag: `browse:<tenant>`. Any product create or delete in that tenant invalidates every browse render.
- **Impact:** under heavy editorial activity the browse cache flushes more than necessary; cold-cache renders are 3–10× slower than warm. For demo data volumes this is invisible.
- **Fix:** add `browse:<tenant>:category:<slug>` tags driven by the search query's category filter. Catalog events with a category change-set fire only those. Adds complexity proportional to taxonomy depth.

### Hand-mirrored REST types in api-client
- **Status:** open; fix designed.
- **What:** [packages/api-client/src/rest.ts](../packages/api-client/src/rest.ts) duplicates Cart, Order, ComputedTotals, etc. from each module's internal contracts package. The duplication is intentional ([ADR-0010](adr/0010-storefront-sellable-separately.md) explains why api-client is the public boundary), but the mirror is hand-written today.
- **Impact:** if a module's contract evolves, the api-client type can drift. [contract.integration.spec.ts](../apps/storefront/src/contract.integration.spec.ts) closes most of the hole — it drives a real cart through checkout and asserts the *exact* key set of `Cart` and `Order`, so a field added or removed on either side fails the run. What it still can't see is a field that became optional, or one whose meaning changed while its name and type stayed put.
- **Fix:** promote every DTO to a Nest class decorated with `@ApiProperty` so `@nestjs/swagger` emits real body schemas, then auto-generate the api-client REST types with `openapi-typescript`. The mirror retires; CI runs the generator and fails on drift.

### No customer auth — order reads go through admin endpoint
- **Status:** scoped out (CLAUDE.md: real auth is the gateway's job, ADR-0007).
- **What:** [/orders/[id]](../apps/storefront/src/app/orders/[id]/page.tsx) reads via `GET /admin/orders/:id`. There's no `/storefront/orders/:id` and no per-customer scoping.
- **Impact:** any browser knowing an order id (which is a uuid v4) can fetch any other customer's order in that tenant. Not a real-world threat for a demo; not acceptable for production.
- **Fix:** customer JWT auth at the gateway (per ADR-0007), a `customers` table tying orders to a customer id, a `/storefront/orders/:id` endpoint that verifies `order.customer_id === current_customer.id` before returning. The api would also drop `/admin/orders/:id` from storefront use.

### Storefront dev secret is checked in
- **Status:** open; only a dev concern.
- **What:** `STOREFRONT_REVALIDATE_SECRET=dev-revalidate-secret-change-me` is in [docker-compose.yml](../docker-compose.yml).
- **Impact:** anyone with the repo can forge a revalidate request to a publicly-reachable storefront. In prod this is overridden via env or a secret manager.
- **Fix:** rotate before any prod deploy. Document in deployment guide (a deferred 7g sub-item).

---

## Catalog

### The seed bypasses the API's write path
- **Status:** open; deliberate trade-off.
- **What:** [apps/seed](../apps/seed) writes attribute definitions and products straight to Postgres via `postgres-js` and straight to OpenSearch via the indexer's own transforms. It does not `POST /admin/products`.
- **Impact:** the seed exercises the storage layers but not the HTTP write path, so it wouldn't catch a controller-level regression — a broken `POST /admin/products` would still leave a fully-populated demo. Attribute *validation* in particular is never run against seeded data.
- **Fix:** an opt-in `SEED_VIA_API=1` mode that routes a small slice (say 500 products per tenant) through the real endpoints while the bulk path stays direct. Full HTTP seeding of 99k products would take minutes instead of seconds, which is why it isn't the default.
- **Note:** the seed *does* bind `app.tenant_id` per connection, so it gets no RLS exemption — a policy that blocks the api blocks the seed too.

---

## Pricing

### Theme/branding lives on pricing.tenant_config
- **Status:** open; deliberate shortcut.
- **What:** the storefront theme (brand name, colors, fonts) is stored as a `theme jsonb` column on [pricing.tenant_config](../packages/modules/pricing/src/db/migrations/0003_branding.sql) — one row already keyed per tenant. Exposed via a `Query.theme` resolver in the pricing module ([branding.resolver.ts](../packages/modules/pricing/src/branding/branding.resolver.ts)).
- **Impact:** pricing now imports a concern (branding) that isn't pricing. The storefront-facing graph IS still separated (`Query.theme` is a different resolver from the admin tenant-config endpoints, so no tax/currency leakage), but the module ownership is muddled.
- **Fix:** extract a `modules/branding/` module that owns the theme column (or its own table), with its own contracts package and resolver. Storage migrates with a `CREATE TABLE branding.theme AS SELECT tenant_id, theme FROM pricing.tenant_config WHERE theme IS NOT NULL` and a drop of the column. The resolver shape stays the same — storefront doesn't notice.

### No domain events emitted from the pricing module
- **Status:** open.
- **What:** [packages/modules/pricing/src](../packages/modules/pricing/src) mutations (upsert price, set tenant config, create/update promotion) don't publish events to the bus. Only the catalog module does.
- **Impact:**
  - The storefront's revalidation pipeline doesn't fire on a price or promotion change. The PDP today reads price from the OpenSearch index, so a price change won't update the displayed price until a catalog reindex happens.
  - Auditability is partial — the audit log captures the HTTP mutation but other modules can't react to pricing changes.
- **Fix:** add `PRICING_EVENTS = { PriceUpserted, PromotionCreated, PromotionUpdated, TenantConfigUpdated }` to pricing/contracts, publish from the services, wire the storefront-webhook dispatcher to invalidate `product:<tenant>:<id>` on `pricing.price.upserted`. Mirrors the catalog pattern exactly.

### PDP price comes from OpenSearch, not Postgres
- **Status:** open; consequence of the above.
- **What:** the PDP displays `attributes.price` which is a denormalised copy in the search index, not the canonical `pricing.prices` row.
- **Impact:** a price change via `POST /admin/prices` updates Postgres immediately, but the storefront sees the old price until the search index is reindexed (which today happens on `catalog.product.updated`, not on pricing events).
- **Fix:** the GraphQL `Query.product` resolver joins pricing in (currently it just returns the OS hit). Or the search indexer subscribes to pricing events and updates the index. Either is a real lift.

---

## API surface

### The API cannot describe itself to a consumer it didn't ship with
- **Status:** open.
- **What:** the public surface exposes catalog, search, pricing, cart and orders, but nothing that advertises the platform's *own* configuration — supported locales, currency, tax display behaviour, which optional capabilities a given tenant has enabled. A consumer has to be told all of it out of band.
- **Impact:** our storefront papers over this by hardcoding what it needs, which only works because one author wrote both sides. Any consumer we didn't write — a customer's own frontend, a mobile client, a partner integration — has no way to discover what a tenant supports, and has to be hand-configured per deployment. For a headless API sold as a standalone product, self-description is table stakes, and its absence undercuts the "complete product on its own" claim more than any missing feature does.
- **Fix:** a `Query.capabilities` resolver (or `GET /storefront/config`) returning per-tenant locales, currency, tax display mode, and a feature map, sourced from the tenant config that already exists. Small, additive, no new storage. Worth doing regardless of who the second consumer turns out to be.

---

## Operations / Security

### Tenant id IS the trust on the api
- **Status:** by design.
- **What:** [`x-tenant-id` header](../packages/shared/tenant-context/src/tenant.middleware.ts) is accepted at face value with no signing or auth. A misbehaving caller can pretend to be any tenant.
- **ADR:** [0007](adr/0007-tenant-id-as-trust-gateway-responsibility.md). Production puts a JWT-validating gateway in front; the gateway extracts the tenant from the validated claims and sets the header. Direct internet exposure is for demo only.
- **Fix path:** Kong / Envoy / Cloudflare Worker enforcing JWT, then injecting `x-tenant-id` from the claims. The api stays unchanged.

### Rate limiting is per tenant, not per IP
- **Status:** open.
- **What:** [@nestjs/throttler](../packages/shared/security/src/throttler.module.ts) tracker uses tenant id. A misbehaving caller posing as tenant X will get rate-limited together with tenant X's legitimate traffic.
- **Impact:** tenant-level DoS is possible during the trust-by-header window.
- **Fix:** layer per-IP limits at the gateway (independent of the api's per-tenant limits). Standard WAF territory.

### Audit log entries don't capture identity beyond request id
- **Status:** open; follows from "no auth yet".
- **What:** [`audit.audit_log`](../packages/shared/security/src/db/migrations/0001_init.sql) columns include tenant_id, method, path, request_id, body summary — not actor.
- **Impact:** with no customer auth, we can't attribute mutations to a user.
- **Fix:** add `actor_id text` column once auth lands; the `audit-log.interceptor.ts` reads the claim out of the request context and populates it.

---

## Architecture

### CI never runs the integration tests
- **Status:** open. This is the highest-value item on the list.
- **What:** [ci.yml](../.github/workflows/ci.yml) runs `lint test build` with no service containers, so `TEST_DATABASE_URL` / `TEST_REDIS_URL` / `TEST_OPENSEARCH_URL` are unset and every integration suite skips. Green CI therefore means "the unit tests pass and it compiles", not "the platform works".
- **Impact:** proven, not theoretical. `catalog.integration.spec.ts` and `checkout.integration.spec.ts` stopped compiling when `ProductsService` and `CheckoutService` gained a `HookRegistry` constructor argument, and both then stopped binding the ALS tenant context the services had started requiring. Nothing noticed for several commits. The suites that prove RLS isolation, snapshot integrity, promotion races and idempotency — the load-bearing claims of the whole project — were dead the entire time while CI stayed green.
- **Fix:** add `services:` for Postgres, Redis and OpenSearch to the workflow and export the three env vars. Postgres needs the `platform` role created by [docker/postgres/init](../docker/postgres/init/01-platform-role.sql), so the service container needs that init script mounted or applied as a step. The storefront conformance suite needs a *seeded* api and so belongs in a separate job that runs `pnpm seed` first, since the module suites drop the schemas.

### Integration suites are destructive to seeded data
- **Status:** by design, but sharp-edged.
- **What:** the module integration suites `DROP SCHEMA ... CASCADE` for `catalog`, `pricing` and `orders` to get a clean slate.
- **Impact:** running the full test suite against the same database you demo from silently empties it. The storefront then renders products with no prices, and checkout fails.
- **Mitigation today:** documented in the README's command block, and the storefront conformance suite fails fast with an explicit "run `pnpm seed`" message rather than a confusing assertion. A dedicated test database would remove the foot-gun entirely.

### The module boundary has a hole for relative imports
- **Status:** open.
- **What:** the ESLint boundary rule keys on Nx project tags, which catches `@platform/modules/x/src` imports. It does not catch a deep relative path — [checkout.integration.spec.ts](../packages/modules/orders/src/checkout.integration.spec.ts) reaches into `../../cart/src/cart.repository` and `../../pricing/src/...` and lints clean.
- **Impact:** the "never import another module's `src/`" rule is enforced for the shape people usually write, not for every shape. In this instance it is a test wiring several modules together the way the composition root does, which is defensible — but the rule isn't actually holding the line, and nothing would stop production code doing the same.
- **Fix:** add an `no-restricted-imports` pattern banning `../../*/src/*` across `packages/modules/**`, then either move the cross-module test wiring into a composition-root-level test project or have it import through each module's public contracts.

### In-process event bus, not a real broker
- **Status:** by design.
- **What:** [@platform/shared/event-bus](../packages/shared/event-bus/src/event-bus.ts) dispatches via `queueMicrotask` in the same process. No durability, no retry, no fan-out across processes.
- **ADR:** [0001](adr/0001-modular-monolith-not-microservices.md). The bus is network-strict in shape (cloned payloads, idempotent handlers, no shared memory across handlers) so swapping in Kafka or NATS later is mechanical.
- **Fix path:** when one module's traffic justifies independent scale, lift its publish-and-subscribe to the broker and keep the rest in-process.

### Microservices documented, not built
- **Status:** by design.
- **ADR:** [0001](adr/0001-modular-monolith-not-microservices.md) + [0008](adr/0008-opentelemetry-designed-not-shipped.md). [docs/ARCHITECTURE.md](ARCHITECTURE.md) has the extraction map — which module splits first, what the inter-service contract is, what changes operationally.

### OpenTelemetry designed, not shipped
- **Status:** by design.
- **ADR:** [0008](adr/0008-opentelemetry-designed-not-shipped.md). The trace topology, instrumentation plan, and OTLP exporter config are documented. Wiring it in is mechanical when there's a collector to point at.

### Kubernetes manifests will be written, not deployed
- **Status:** by design.
- **What:** CLAUDE.md "out of scope" — write manifests, don't deploy. Docker compose is the genuinely-runnable artefact.

---

## Demo-readiness gaps (separate from platform gaps)

Items tracked in the pre-demo checklist (in user memory). They don't affect platform capability:

- GitHub repo description + topics empty.
- No `v0.1.0` git tag.
- No CI status badge.
- No screencast or screenshots; [LOOM-SCRIPT.md](LOOM-SCRIPT.md) is written but nothing is recorded.
- The README's 60-second tour has never been run from a cold clone.

---

## How this list is maintained

When a feature lands with a known limitation, the limitation goes here in the same PR. When a limitation is fixed, the item is removed (this is a *current-state* doc, not a changelog).

Items marked **by design** with an ADR reference stay forever as the documented "we considered this and chose not to". Items marked **open** are work that should land; they should not silently age.
