# Known caveats and follow-ups

The honest list. Things this platform doesn't do today, edges where it makes a trade-off worth knowing about, and the concrete path to fix each. Organized by area.

Every item has a **status**: *by design* (intentional, see linked ADR), *scoped out* (out of CLAUDE.md scope today), or *open* (real gap, has a fix path).

---

## Storefront

### CSP in production breaks hydration
- **Status:** open.
- **What:** [next.config.mjs](../apps/storefront/next.config.mjs) sets `script-src 'self'` in production. Next.js 14 streams the RSC payload and React hydration data via inline `<script>` blocks; a strict prod CSP blocks them.
- **Impact:** a production build today renders static HTML but never hydrates. No interactivity. We added `'unsafe-inline'` in dev only.
- **Fix:** per-request nonce in `middleware.ts` (`crypto.randomUUID()`), attach via Next's `<Script nonce={nonce}>` for the framework's own inline scripts, reference as `'nonce-<value>'` in CSP. Required before any production deploy.

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
- **Impact:** if a module's contract evolves, the api-client type can drift silently. The full purchase-flow integration test catches structural mismatch but not e.g. a field that became optional.
- **Fix:** promote every DTO to a Nest class decorated with `@ApiProperty` so `@nestjs/swagger` emits real body schemas, then auto-generate the api-client REST types with `openapi-typescript`. The mirror retires; CI runs the generator and fails on drift.

### No customer auth — order reads go through admin endpoint
- **Status:** scoped out (CLAUDE.md: real auth is the gateway's job, ADR-0007).
- **What:** [/orders/[id]](../apps/storefront/src/app/orders/[id]/page.tsx) reads via `GET /admin/orders/:id`. There's no `/storefront/orders/:id` and no per-customer scoping.
- **Impact:** any browser knowing an order id (which is a uuid v4) can fetch any other customer's order in that tenant. Not a real-world threat for a demo; not acceptable for production.
- **Fix:** customer JWT auth at the gateway (per ADR-0007), a `customers` table tying orders to a customer id, a `/storefront/orders/:id` endpoint that verifies `order.customer_id === current_customer.id` before returning. The api would also drop `/admin/orders/:id` from storefront use.

### shadcn/ui not integrated
- **Status:** open.
- **What:** the storefront uses plain Tailwind utilities. shadcn/ui (and Radix primitives under it) is the modern norm and listed in the stack but not wired.
- **Impact:** components reinvent the wheel for accessibility (focus rings, ARIA), and theming variability is limited.
- **Fix:** `pnpm dlx shadcn-ui@latest init`, replace `Button`, `Card`, `Input`, `Sheet` (for mobile cart drawer) in tranches. No architectural change.

### Storefront dev secret is checked in
- **Status:** open; only a dev concern.
- **What:** `STOREFRONT_REVALIDATE_SECRET=dev-revalidate-secret-change-me` is in [docker-compose.yml](../docker-compose.yml).
- **Impact:** anyone with the repo can forge a revalidate request to a publicly-reachable storefront. In prod this is overridden via env or a secret manager.
- **Fix:** rotate before any prod deploy. Document in deployment guide (a deferred 7g sub-item).

---

## Catalog

### Seed only populates OpenSearch, not catalog.products
- **Status:** open.
- **What:** [apps/seed](../apps/seed) writes 99k products straight to the per-tenant OS indices; `catalog.products` in Postgres stays empty until you `POST /admin/products`.
- **Impact:**
  - README verification #2 (RLS killshot against `catalog.products`) returns 0 rows for both bound and unbound queries. We worked around it by using `pricing.prices` instead.
  - The seed flow doesn't demonstrate the catalog write-path end-to-end.
- **Fix:** extend `apps/seed` to also write to `catalog.products` via the api's `/admin/products` endpoint (slow but realistic) or bulk-insert via the repository (fast). Plus seed attribute definitions first so the products carry real custom attributes through Postgres validation.

### Attribute definitions are not seeded
- **Status:** open, follows from the above.
- **What:** `catalog.attribute_definitions` is empty per tenant. POSTing `/admin/products` with attributes fails validation (`"unknown attribute 'color' for this tenant"`).
- **Impact:** creating a product via the API requires you to first `POST /admin/attribute-definitions` for each attribute. The seed should do this.
- **Fix:** seed step that defines `brand`, `color`, `size`, `price`, `in_stock`, `released_on` (and tenant-specific extras: `voltage` for electronics, `pages` for books) before product creation.

---

## Pricing

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

- No `LICENSE` file (README references one).
- GitHub repo description + topics empty.
- README's RLS killshot points at `catalog.products` (empty by default) — should use `pricing.prices`.
- No `v0.1.0` git tag.
- No CI status badge.
- No screencast or screenshots.

---

## How this list is maintained

When a feature lands with a known limitation, the limitation goes here in the same PR. When a limitation is fixed, the item is removed (this is a *current-state* doc, not a changelog).

Items marked **by design** with an ADR reference stay forever as the documented "we considered this and chose not to". Items marked **open** are work that should land; they should not silently age.
