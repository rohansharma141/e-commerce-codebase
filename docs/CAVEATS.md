# Known caveats and follow-ups

The honest list. Things this platform doesn't do today, edges where it makes a trade-off worth knowing about, and the concrete path to fix each. Organized by area.

Every item has a **status**: *by design* (intentional, see linked ADR), *scoped out* (out of CLAUDE.md scope today), or *open* (real gap, has a fix path).

---

## Storefront

### Webhook delivery gives up, then a sweep re-drives it — three times
- **Status:** by design; know where the last door closes.
- **What:** deliveries retry with exponential backoff (2s doubling, six attempts, roughly two minutes of patience) and are then marked `exhausted`. A dead-letter sweep runs on a slower cadence, returns exhausted rows to the queue and counts the re-queue in `requeues`. After three re-queues the row stays a dead letter for good.
- **Why bounded:** an unbounded sweep is an infinite retry loop wearing a different name. The cap means an outage recovers automatically while a consumer that is genuinely gone stops being chased.
- **Impact:** a storefront down longer than the backoff no longer strands changes — that used to require someone noticing and writing `UPDATE` by hand. What is still manual is the row that exhausts its re-queues: it is queryable (`WHERE exhausted`) and carries its last error, but nothing escalates it.
- **Fix if it ever matters:** alerting on `SELECT count(*) FROM audit.webhook_outbox WHERE exhausted`, which is the metric an operator would actually want. Not worth building before there is an operator.
- **Demo settings:** `docker-compose.yml` sets 2 attempts and a 15s sweep so the whole cycle is observable in under a minute. Production defaults are 6 and 60s.

### The read path is a GET, and has to stay one
- **Status:** resolved, and worth keeping visible because the failure mode is silent.
- **What:** storefront reads go over `GET /graphql`. Next's data cache stores GET responses only — it accepts `next: { tags, revalidate }` on a POST and ignores it. For as long as these reads were POSTs, nothing was cached, every route re-queried the api, and every `revalidateTag` in the webhook route invalidated something that was not there.
- **Why it went unnoticed:** an empty cache is never stale. The storefront was correct the whole time, just silently much slower than the architecture doc claimed, and no check compared a second request against a first.
- **Guard:** `apps/storefront/src/lib/api-graphql.spec.ts` fails if the method goes back to POST or the tenant header stops being sent per call. Verified by breaking it both ways.
- **Also required:** Apollo answers `cache-control: no-store` by default, which Next honours; `apps/api/src/graphql-cache.plugin.ts` replaces it for GET.

### Tenant isolation of cached reads rests on Vary and the tenant header
- **Status:** open by nature — a property to keep checking, not a bug to fix.
- **What:** every tenant asks the same GraphQL question at a byte-identical URL. What separates their cache entries is the `x-tenant-id` request header, which Next includes in its cache key, and `Vary: x-tenant-id`, which the api now sends on every GraphQL response so no intermediary can key on the URL alone.
- **Impact if it regresses:** one tenant served another tenant's catalogue from cache. This is the worst failure available to this system, and it would look like a working, fast site.
- **Held down by:** the unit test above for the header, and by running the stack — two tenants requesting the same page get their own brand and their own SKUs. Re-check it after any change to the read path or to caching.

### The public REST names are curated by hand, the types are not
- **Status:** resolved as a duplication problem; the remaining judgement is deliberate.
- **Was:** `packages/api-client/src/rest.ts` was 124 hand-written lines duplicating Cart, Order, ComputedTotals and friends, kept true only by the conformance test. It existed because the api's DTOs were interfaces, so `@nestjs/swagger` emitted `{}` for every body and `openapi-typescript` would have produced nothing usable.
- **Now:** the DTOs are classes with `@ApiProperty` (R-1, R-2), the api publishes 17 real schemas, and `src/generated/rest-api.ts` is generated from them (R-3a). `rest.ts` is deleted (R-3b).
- **What is still by hand, on purpose:** the *names*. `src/index.ts` aliases selected schemas rather than re-exporting the whole document, because api-client is the storefront's entire view of the api and deciding what is public belongs there. A schema not named in that file is not part of the client surface. Renaming a schema on the api side breaks the build rather than silently changing what the storefront sees.
- **Drift is caught:** the conformance job regenerates against the live api and fails if the committed file differs (R-4). Proved by committing a hand-edit on a branch and watching that step fail on a real runner.

### No customer auth — order reads go through admin endpoint
- **Status:** scoped out (CLAUDE.md: real auth is the gateway's job, ADR-0007).
- **What:** [/orders/[id]](../apps/storefront/src/app/%28shop%29/orders/[id]/page.tsx) reads via `GET /admin/orders/:id`. There's no `/storefront/orders/:id` and no per-customer scoping.
- **Impact:** any browser knowing an order id (which is a uuid v4) can fetch any other customer's order in that tenant. Not a real-world threat for a demo; not acceptable for production.
- **Fix:** customer JWT auth at the gateway (per ADR-0007), a `customers` table tying orders to a customer id, a `/storefront/orders/:id` endpoint that verifies `order.customer_id === current_customer.id` before returning. The api would also drop `/admin/orders/:id` from storefront use.

### The price filter shows `$` whatever the currency
- **Status:** open — C-40. Predates the channels slice; also on `main`.
- **What:** the facet sidebar prints a hardcoded `$` beside its minimum and maximum price inputs ([facet-sidebar.tsx](../apps/storefront/src/components/facet-sidebar.tsx)), so `t-fashion`, which sells in GBP, shows `$`. [STOREFRONT.md](STOREFRONT.md#theming-and-money--both-come-from-the-api) says money is formatted from the api's descriptor "and nothing else"; this is the exception. Found 2026-09-22 while rendering C-19a's pages in a headless browser.
- **Fix:** take the symbol from the same `MoneyFormat` the prices are formatted with.

### Storefront dev secret is checked in
- **Status:** open; only a dev concern.
- **What:** `STOREFRONT_REVALIDATE_SECRET=dev-revalidate-secret-change-me` is in [docker-compose.yml](../docker-compose.yml).
- **Impact:** anyone with the repo can forge a revalidate request to a publicly-reachable storefront. In prod this is overridden via env or a secret manager.
- **Fix:** rotate before any prod deploy. The procedure, the two different env-var names, what the mismatch window costs and how to verify it in both directions are in [RUNBOOK.md](RUNBOOK.md#rotating-the-revalidate-secret).

---

## Catalog

### The seed's fast path bypasses the API, unless you ask it not to
- **Status:** by design, with an opt-in check.
- **What:** [apps/seed](../apps/seed) writes 99k products straight to Postgres and OpenSearch, because going through HTTP would turn a fifteen-second seed into a multi-minute one. `SEED_VIA_API=1` routes a 25-product slice per tenant through the real endpoints instead — `POST /admin/attribute-definitions`, `/admin/products`, `/admin/prices` — exercising middleware, tenant binding, DTO handling, attribute validation, the repository, the event bus and the indexer.
- **Why the slice is small and subtracted:** it comes out of the tenant's product budget rather than being added to it, so totals stay exactly 33,000 either way and the README's numbers hold whichever mode you run.
- **Verified:** with `POST /admin/products` deliberately throwing, the default seed still exits 0 — the blind spot — while `SEED_VIA_API=1` exits 1 naming the failing route and status.
- **Remaining gap:** the default is still the fast path, so an unbroken CI run does not prove the write path works. Wiring `SEED_VIA_API=1` into the conformance job would close that; it needs the api up, which that job already has.

---

## Pricing

### Price is denormalised into the search index
- **Status:** by design; kept honest by events.
- **What:** the canonical price is the `pricing.prices` row. The PDP and browse cards read `attributes.price` from the OpenSearch document, which is a copy. `pricing.price.upserted` drives the search indexer to patch that copy, and the storefront's cache is invalidated only once the patched document is readable, so the copy converges within a second or so of the write.
- **Impact:** the copy is eventually consistent, not transactionally consistent. A read taken in the gap sees the old price. This is fine for display, and deliberately not what checkout uses — totals are computed from `pricing.prices` inside the checkout transaction, so the price a customer is charged never comes from the index.
- **Sharp edge:** the unit conversion is a trap. Pricing stores integer cents; the indexed attribute is in major units, because that is what the seed writes and what the price-range filter compares against. Anything else writing that field has to convert, and getting it wrong multiplies every displayed price by 100 while quietly breaking range filters.
- **Fix if the gap ever matters:** have `Query.product` read price from pricing rather than the index. That costs a per-request cross-module read on the hottest storefront path, which is why it isn't the default.

---

## Channels

Added by the channels slice (ADR-0014). Every one of these is a *stated* simplification rather than something nobody thought about — which is the only thing that makes them defensible.

### The missing-channel fallback has an expiry, and the expiry is the point
- **Status:** open, with a deadline. This entry is the deadline.
- **What:** a request that sends no `x-channel-id` resolves to the tenant's default channel. That is what keeps the shipped storefront working unchanged while the slice lands, and it is deliberately different from sending an *unknown* channel, which is a `404` and never falls back.
- **Why it must not become permanent:** an undated fallback is indistinguishable from a feature. Once every caller sends scope, "unspecified" stops meaning "the default" and starts meaning "a misconfigured integration transacting in the wrong currency" — and it will look like it is working.
- **Expiry, decided 2026-09-22:** a channel is **required everywhere** on the storefront surfaces — GraphQL on every path, and `/storefront/*`. The default is named by its key like any other channel; a caller learns that key from `GET /system/capabilities`, the one exempt, unscoped read. Admin is not channel-scoped and is unaffected. The order is fixed so nothing breaks: the storefront names its channel on every call (C-19b, C-19e), every documented command and spec does (C-41), and only then does the api answer `400` to a request that names none (C-42). [ADR-0014](adr/0014-channel-as-sales-channel.md) §2 and §8 carry the amendment and the options weighed.
- **Held down by:** `scoped-graphql.integration.spec.ts`, which asserts both halves — the three-segment URL still resolves the default, and an unknown channel `404`s rather than degrading to it. C-42 turns the first half into a `400`.

### One currency per channel — this is not multi-currency
- **Status:** by design; the boundary is real and worth stating plainly.
- **What:** a channel has exactly one `currency_code`. Selling in GBP and EUR means two channels, not one channel with two prices.
- **What real multi-currency would need, none of which exists:** price rows per currency; an FX policy (the enterprise answer is almost always *no runtime conversion*, because a converted price is not a price anyone agreed); per-currency rounding rules; and defined behaviour when a price is missing in the requested currency — fall back, hide the product, or fail.
- **Impact:** a tenant wanting one storefront that switches currency in place cannot have it. A tenant wanting a UK store and a German store can *configure* both — but see the next entry: today only the one matching the price list's currency charges correctly.
- **Sharp edge:** `currency_code` **freezes** once the channel has transacted. Changing it afterwards would silently reinterpret every existing order's minor-unit integers — the orders store cents, not money. Snapshots protect how an order *renders*, not what it *aggregates to*.

### A channel's currency is declared, not charged
- **Status:** **closed by refusal** (gate G-4 in [BACKLOG-channels.md](BACKLOG-channels.md)); per-channel price lists, which would make such a channel sell, are Phase H. Since C-32a carts and checkout refuse it with `422 channel.unservable` — no cart, no order, no promotion use — and since C-32b every storefront request in it does, reads included. Admin still manages it. So `t-fashion`'s `de` is configured, visible to operators, and unavailable to shoppers until prices exist in EUR or its currency is set to GBP. Since C-19d a shopper who reaches it is told so — "Not available in this market", `200` and `noindex` — rather than shown a server error.
- **What:** a channel has a `currency_code`, validated on write, frozen after its first order, reported by the admin API. But `pricing.prices` holds one currency-less integer per product, and `TotalsService` reads currency and tax rate from the tenant-level `pricing.tenant_config`. Nothing on the money path consults the channel. Seen live on 2026-09-19: an order placed in `t-fashion`'s `de` channel (EUR) came back `currency: GBP`.
- **Impact:** for a tenant whose channels share the price list's currency — `t-electronics`, `t-books` — none. For `t-fashion`'s `de`, the channel's currency is a label that does not describe what is charged. C-17's currency freeze is correct and necessary, but it currently protects a value checkout does not use.
- **Why it is a decision and not a bug fix:** ADR-0014 §9 says a missing price in a channel's currency must *fail* — "falling back to another currency's number is a money bug" — and §12 defers per-channel prices. So the specified options are **refuse to transact** in a channel the price list cannot serve, or **build per-channel price lists** (its own ADR; it touches the denormalised price in the search index). The tempting third option — charge the same integer under the channel's symbol — is the money bug the ADR names.
- **How it got here:** the design documents were written without repository access and never assigned this work to a row; reconciliation did not catch it; and four code comments then called it "C-18's job", which it is not. Found only because C-17's live check printed a channel and a currency on the same line.

### Locales drive formatting, not translation
- **Status:** by design; the naming invites the wrong expectation, so it is spelled out.
- **What:** a channel's `default_locale` and `supported_locales` control number, date and currency formatting. They do **not** select translated content.
- **Impact:** a `de-DE` channel renders `1.234,56 €` around **English** product copy. That is a strange-looking page, and it is the honest state.
- **Why not more:** the catalog has no locale dimension at all. Translation means a locale axis on product name, description and attributes, a fallback chain, and a back-office editing surface for each — a catalog change touching the hero feature, not a channels change.
- **Fix path:** localized content is its own slice with its own ADR. `supported_locales` is the seam it would hang from.

### Tax is one flat rate per channel, with a named seam
- **Status:** by design, and the least defensible item here if it were not stated.
- **What:** `tax_rate_bps` is a single integer per channel. `tax_display` selects gross or net presentation, and the engine computes both (C-29).
- **What it cannot express:** tax classes (food versus electronics), US destination-based tax (rate depends on the buyer's address, not the seller's), EU OSS thresholds, B2B reverse charge, or any exemption.
- **Impact:** correct for a demo and for a single-rate jurisdiction. Not correct for anyone actually filing returns.
- **The seam:** `tax_rate_bps` is nullable precisely so it can become null when a real tax provider (Avalara, TaxJar, Stripe Tax) is wired in. Rate resolution moves behind a provider interface; nothing else in the model changes.

### A channel's tax rate is configuration nothing charges yet
- **Status:** open — C-38. Found 2026-09-22 while building C-18a.
- **What:** a channel's `taxRateBps`, its own or inherited from the tenant defaults, is validated, stored and shown by the admin API. Totals and checkout charge `pricing.tenant_config.tax_rate_bps` instead. Demonstrated: `trade` set to 0 through admin, a cart in `trade` taxed at 875 bps.
- **Impact:** none for the seeded tenants, whose channel and pricing rates are equal because the seed derives one from the other. An operator who sets a channel's rate sees it accepted and not applied — the same shape as gate G-4 for currency.
- **Held honest meanwhile:** `capabilities.taxRateBps` reports the rate checkout charges, not a channel's configured one, and stays tenant-level until C-38 makes the channel's rate the charged one.

### Cache entries multiply by channels per tenant
- **Status:** open; fine now, worth watching.
- **What:** URL scoping puts the channel key in the path, so each channel gets its own cache entry for the same page. A tenant with four channels has four times the entries it had.
- **Why that is the right trade:** the alternative is one entry keyed only on the URL, which is how a UK shopper gets served the German channel's EUR prices — demonstrated in `scoped-graphql.integration.spec.ts` against a proxy that keys on URL alone, and it reproduces against the unscoped path today.
- **Impact:** at single-digit channels per tenant, nothing. It becomes a capacity question if channels ever proliferate, which is a product signal worth noticing rather than a bug.

### The consuming-module read-model is unbounded
- **Status:** open; deliberately unbounded, with the condition that would change it.
- **What:** `ChannelReadModel` (C-14) holds resolved channel configuration in two `Map`s with no eviction and no size cap. Entries are removed only by an event or by tenant invalidation.
- **Why unbounded is right today:** a tenant has single-digit channels, and the whole platform's set fits in memory many times over. An eviction policy would add a way to be wrong (evicting something still needed, then re-reading it) in exchange for solving a problem that does not exist.
- **What would change it:** channels proliferating — per-store channels for a retailer with hundreds of locations, say. Then it needs a bound, and the natural one is an LRU per tenant, because a miss is already safe: it falls through to the source rather than failing.
- **Not a leak:** the set is bounded by the number of channels that exist, not by traffic. It grows with data, not with requests.

### The currency freeze is eventually consistent, and rides a bus with no durability
- **Status:** by design; two small windows, both stated.
- **What:** a channel's `currency_code` freezes once it has transacted, because orders store money as integers in that currency's minor units and changing it afterwards silently reinterprets every one of them. The flag is set by `ChannelTransactedConsumer` reacting to `orders.created` — not inside checkout, because a cross-module write in checkout's transaction is forbidden.
- **Window 1 — milliseconds:** the bus is asynchronous (`publish()` schedules handlers on a microtask and returns), so checkout resolves before the mark commits. For a channel's very first order there is a brief moment in which its currency is still editable. It only matters if an operator's currency edit races that first order.
- **Window 2 — until the next order:** handler failures are isolated by the bus, deliberately — a failed mark must never fail a customer's checkout — and the in-process bus has no retry or replay. A dropped or failed `orders.created` therefore leaves the channel unfrozen. The UPDATE is conditional on `has_transacted = false`, so *every* later order in that channel re-attempts it and the gap self-heals at the next order. The residual exposure is a channel whose only-ever order had its event dropped.
- **Held down by:** `checkout.integration.spec.ts` — unwiring the consumer fails the freeze test, and removing the conditional fails the redelivery test (which asserts `updated_at` does not move on a second delivery).
- **A hole, found 2026-09-22 — C-37:** the freeze checks a channel's *own* `currency_code` only. A channel that **inherits** its currency can have it changed after transacting by editing the tenant defaults; demonstrated with `uk`. Since C-32 the result is a refused channel rather than a wrong charge, but the freeze does not yet protect what it says it protects.
- **Fix if it ever matters:** a real broker with at-least-once delivery closes window 2 outright, and is the same change CAVEATS already lists under *In-process event bus, not a real broker*. Window 1 closes only with a synchronous cross-module write, which is the wrong trade.

### A tenant created after the C-11 backfill has no channel
- **Status:** open; small, and stated so the backfill is not read as a guarantee.
- **What:** every tenant needs a default channel — cart creation and checkout resolve it, and a tenant without one gets a `500` on every basket. The seed writes one for each fixture tenant, and the C-11 migration gives one to every tenant in `pricing.tenant_config` at the moment it runs. Nothing creates one for a tenant added later through `PUT /admin/tenant-config`.
- **Workaround:** create its first channel with `POST /admin/channels`, then `POST /admin/channels/:id/promote-default`.
- **Reads are unaffected:** C-32b's refusal passes a tenant with no default channel through, so such a tenant browses as it did before channels. Only its baskets fail.
- **Also:** a backfilled channel is not marked `has_transacted`, even where the tenant already had orders — those predate the channel, and the backfill does not read orders. Its currency is editable until the next order marks it through C-17's consumer. The orders themselves carry their own `currency` and render as charged.
- **Fix:** tenant onboarding creates the tenant defaults and a default channel in one step — C-35.

### The storefront's channel prefix has two costs
- **Status:** open; the first by design, the second worth a small fix.
- **What:** a shopper reaches a channel as `/{channelKey}/…` (C-19a). A channel keyed like one of the storefront's own first segments — `c`, `p`, `cart`, `orders`, `api` — is unreachable by prefix, although the api's key grammar admits all five. And the default channel also answers under its own key, so `/uk/c/dresses` and `/c/dresses` are one page at two URLs with no canonical link between them.
- **Why the first is accepted:** the api avoids the same collision by putting tenants under a reserved `/api`, which a URL meant for shoppers cannot afford. The api is deliberately not taught the storefront's routes — it ships without the storefront.
- **Held down by:** `channel-path.spec.ts`, which fails when a top-level route is added without being reserved.
- **Fix for the second:** a `<link rel="canonical">` to the unprefixed URL when the named channel is the default.

### Authentication is a prerequisite that has not been built
- **Status:** open, and the only item here that blocks a phase.
- **What:** gate G-1 decided the back office may not ship without a login. [ADR-0015](adr/0015-operator-authentication-at-the-api-edge.md) designs it — the four gateway behaviours ADR-0007 has specified since May, one operator role, IdP left as configuration — and none of it is built.
- **Why it is a caveat and not just a backlog row:** the admin surface is *already* live and unauthenticated. Today that is the same posture as the rest of the api (ADR-0007: tenant id is the trust, a gateway is assumed in front), so it adds no new exposure. It stops being equivalent the moment a back-office deployable exists, because a console is a user-facing app and the manifests publish those through a wildcard Ingress.
- **Sequencing:** the auth slice lands before C-20, not after. An admin console reachable without a credential is not a caveat anyone would accept.

### Every channels claim is verified locally, not in CI
- **Status:** open; the gap is process, not code.
- **What:** CI triggers on `main` and on pull requests into it. The `channels` branch has neither, so nothing on it has run on a clean runner.
- **Impact:** every "verified" statement in [BACKLOG-channels.md](BACKLOG-channels.md) rests on one machine with a warm Docker cache and an installed toolchain. This project has already been bitten by exactly that gap — the first real CI run found a migration concurrency race that was invisible locally, and the channels Dockerfile omission was invisible until a container was built.
- **Fix:** open the PR, or add the branch to the workflow trigger. Roughly fifteen minutes either way.

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
- **Mitigation today:** documented in the README's command block, and the storefront conformance suite fails fast with an explicit "run `pnpm seed`" message rather than a confusing assertion. A dedicated test database removes the foot-gun: the [RUNBOOK](RUNBOOK.md#running-the-live-suites) now creates `platform_test` for exactly this. The channels slice's migration specs (C-11, C-33) are written not to drop anything, so they are safe against any database.
- **Not yet addressed:** nothing serialises the schema-dropping suites against *each other*. CI runs every project's tests at once (`nx run-many`, and jest's parallel workers within a project) against one database, so two suites dropping the same schema can overlap. It has not visibly bitten `main`; CI has never run on the `channels` branch, which adds two more such suites. A shared advisory lock taken in each destructive suite's `beforeAll` would close it — C-34.

### Cross-module test wiring lives in the composition root
- **Status:** by design, worth knowing where to put things.
- **What:** the boundary rule is now enforced in spec files as well as production code, and a second rule bans reaching into another module's `src` by relative path. A test that genuinely needs to wire several modules together — [checkout.integration.spec.ts](../apps/api/src/checkout.integration.spec.ts), which builds cart + pricing + orders into one object graph — therefore lives in `apps/api`, the one place permitted to know module internals.
- **Consequence:** `packages/modules/orders/src` has no spec of its own, and its jest target runs with `passWithNoTests`. The module's behaviour is covered, just from the composition root rather than from inside.
- **Why not exempt tests instead:** that was the previous arrangement and it meant the repository's loudest architectural claim was unenforced in precisely the files most tempted to break it.
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

### Kubernetes manifests written, not deployed
- **Status:** by design, and now actually written.
- **What:** [deploy/k8s/](../deploy/k8s/) — 16 resources across two bundles, `api/` standing alone for the API-only product. No cluster is provisioned; Docker Compose remains the genuinely-runnable artefact.
- **Data stores are deliberately not in the cluster.** Postgres, Redis and OpenSearch are referenced as managed endpoints in a Secret. Running Postgres as a StatefulSet to make the manifests look complete would be the wrong lesson.
- **Kept honest by:** a CI step validating every file against the real Kubernetes schemas in strict mode. Nothing else exercises them, so without it "not deployed" would quietly become "would not apply".
- **Was previously a false claim:** README.md and PROJECT-BRIEF.md both said "manifests written" before any existed.

---

## Demo-readiness gaps (separate from platform gaps)

Sequenced in [BACKLOG.md](BACKLOG.md) under 8d. They don't affect platform capability:

- No screencast or screenshots; [LOOM-SCRIPT.md](LOOM-SCRIPT.md) is written but nothing is recorded.
- The README's tour was run cold on 2026-08-26; all seven findings are fixed (8d-7). It now states its prerequisites, the build time is honest, and every verification is runnable end to end. The Node 22-only restriction it documented is gone (H-6): pnpm 10 installs and builds on Node 24, and a CI job keeps that true.

---

## How this list is maintained

When a feature lands with a known limitation, the limitation goes here in the same PR. When a limitation is fixed, the item is removed (this is a *current-state* doc, not a changelog).

Items marked **by design** with an ADR reference stay forever as the documented "we considered this and chose not to". Items marked **open** are work that should land; they should not silently age.
