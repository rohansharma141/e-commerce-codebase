# Known caveats and follow-ups

The honest list. Things this platform doesn't do today, edges where it makes a trade-off worth knowing about, and the concrete path to fix each. Organized by area.

Every item has a **status**: *by design* (intentional, see linked ADR), *scoped out* (out of CLAUDE.md scope today), or *open* (real gap, has a fix path).

---

## Storefront

### Webhook delivery gives up after six attempts
- **Status:** by design, but know where the edge is.
- **What:** deliveries go through the `audit.webhook_outbox` table and a polling worker that retries with exponential backoff — 2s doubling to a 5-minute cap, six attempts, roughly two minutes of total patience. After that the row is marked delivered with the failure preserved in `last_error`.
- **Impact:** a storefront down for longer than that keeps whatever it had cached until the one-hour time-based fallback expires. The change is not lost silently — there is a queryable row saying which webhook never landed and why — but nothing re-drives it automatically.
- **Fix:** a dead-letter sweep that re-queues exhausted rows, or a startup reconciliation on the storefront side that drops its cache wholesale after downtime. Neither is worth building before there is an operator to act on it.

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

### Price is denormalised into the search index
- **Status:** by design; kept honest by events.
- **What:** the canonical price is the `pricing.prices` row. The PDP and browse cards read `attributes.price` from the OpenSearch document, which is a copy. `pricing.price.upserted` drives the search indexer to patch that copy, and the storefront's cache is invalidated only once the patched document is readable, so the copy converges within a second or so of the write.
- **Impact:** the copy is eventually consistent, not transactionally consistent. A read taken in the gap sees the old price. This is fine for display, and deliberately not what checkout uses — totals are computed from `pricing.prices` inside the checkout transaction, so the price a customer is charged never comes from the index.
- **Sharp edge:** the unit conversion is a trap. Pricing stores integer cents; the indexed attribute is in major units, because that is what the seed writes and what the price-range filter compares against. Anything else writing that field has to convert, and getting it wrong multiplies every displayed price by 100 while quietly breaking range filters.
- **Fix if the gap ever matters:** have `Query.product` read price from pricing rather than the index. That costs a per-request cross-module read on the hottest storefront path, which is why it isn't the default.

---

## API surface

### Capability features describe the deployment, not the tenant
- **Status:** open; costs nothing today.
- **What:** `Query.capabilities` and `GET /system/capabilities` report per-tenant currency, minor units, locale, tax display and rate, plus a feature map. The per-tenant half is real; the feature map is a constant shared by every tenant.
- **Impact:** none yet — no capability actually varies per tenant. It would matter the moment one did, e.g. a tenant on a plan without promotions.
- **Fix:** a per-tenant override table consulted when building the list. The response is a list of `{key, enabled}` rather than fixed boolean fields precisely so this can land without changing the shape consumers already parse.
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

### CI's first real run found a concurrency bug in the migration runner
- **Status:** closed, recorded because the failure mode is worth remembering.
- **What:** CI's `verify` job runs 23 projects in parallel against a *fresh* database, so several module suites applied their migrations at once. `CREATE EXTENSION IF NOT EXISTS pgcrypto` is not atomic — two transactions both saw it missing, both inserted, one died on `pg_extension_name_index`, and the aborted apply left that module's schema uncreated so every later statement failed with "schema does not exist".
- **Why it was invisible locally:** a developer's database already has every migration applied, so the files are skipped and nothing races. Only a first run on an empty database exposes it — which is exactly what CI does and what a `docker compose down -v` does.
- **Fix:** [migrator.ts](../packages/shared/database/src/migrator.ts) now holds a session-level advisory lock for the whole of `apply()`, covering the ledger read-then-write as well as the DDL. Reproduced locally by dropping all four schemas plus the extension, then re-running the suite.
- **Worth noting:** this was never only a test problem. Two api replicas starting together, or a rolling deploy, race identically.


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

Sequenced in [BACKLOG.md](BACKLOG.md) under 8d. They don't affect platform capability:

- GitHub repo description + topics empty.
- No screencast or screenshots; [LOOM-SCRIPT.md](LOOM-SCRIPT.md) is written but nothing is recorded.
- The README's 60-second tour has never been run from a cold clone.

---

## How this list is maintained

When a feature lands with a known limitation, the limitation goes here in the same PR. When a limitation is fixed, the item is removed (this is a *current-state* doc, not a changelog).

Items marked **by design** with an ADR reference stay forever as the documented "we considered this and chose not to". Items marked **open** are work that should land; they should not silently age.
