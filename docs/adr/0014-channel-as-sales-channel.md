# ADR-0014: Channel means sales channel; supply is a separate concept

**Status:** Accepted
**Date:** 2026-08-28
**Related:** [0001](0001-modular-monolith-not-microservices.md) (module boundaries, extraction path), [0007](0007-tenant-id-as-trust-gateway-responsibility.md) (tenant is the trust boundary), [0008](0008-opentelemetry-designed-not-shipped.md) (instrumentation designed, not wired)

## Context

The platform is multi-tenant but single-market. Each tenant has one currency, one locale, one tax configuration, one theme, one implicit storefront. `Query.capabilities` and `GET /system/capabilities` report those per tenant, and the storefront consumes them rather than hardcoding `$` / `en-US` / two decimals.

That cannot express what a merchant needs: one business selling through several storefronts, markets or applications — a UK store in GBP and a German one in EUR, or a web store and a marketplace sharing a catalogue but not a price list.

The word `channel` carries no existing meaning anywhere in the codebase — verified before adopting the vocabulary.

Both reference platforms solve this, and the obvious reading of commercetools is out of date. CT introduced `Channel` distinguished by a `roles` array (`InventorySupply`, `ProductDistribution`, …); that proved insufficient for "where do I sell", and CT later added **Stores** carrying languages, countries, channel references and product selections. In current implementations Stores answer "where you sell" and Channels mostly "where stock lives". Intershop is more explicit: sales channels tie to applications, warehouses are separate.

## Decision

**`Channel` means a sales channel, and nothing else.** It belongs to a tenant and carries the properties defining a selling context: currency, locales, country, timezone, tax display — and in later slices catalogue scope, payment methods, storefront binding, theme.

**Supply is deliberately not modelled.** Inventory will introduce a separate `InventorySource`. A physical store that both sells and holds stock is a channel *and* an inventory source, optionally sharing a location record — not one row wearing two hats.

`Channel` is owned by a new `channels` module: public `contracts/`, private `src/`, own Postgres schema, no foreign keys across module schemas.

## Alternatives considered: one Channel entity with a roles array

**The field sets barely overlap.** A sales channel needs currency, locales, country, tax display, catalogue scope, payment methods, a domain, a theme. A supply location needs an address, stock levels, fulfilment priority, geography. They share an id and a name. A roles array then forces either columns mandatory for one role and meaningless for the other — which the type system cannot check and the database can only express as nullable — or a JSON blob, the same problem with fewer tools. Every read filters by role.

**It replicates the wrong layer of the reference implementation.** Roles are what CT built *before* Stores.

**The retrofit costs are asymmetric, and that decides it.** Build sales-channel-only and later need supply: *add* `InventorySource`; existing channels keep their meaning, nothing migrates. Build roles and the field sets diverge — they will — and you unpick a shared table catalog, pricing and orders already query. Low retrofit cost against high up-front abstraction cost is the reasoning of [0001](0001-modular-monolith-not-microservices.md).

---

## Consequences

### 1. Channel is not a trust boundary

Tenant is the isolation boundary and stays so ([0007](0007-tenant-id-as-trust-gateway-responsibility.md)). Channel is *scope selection within an already-resolved tenant*: a caller validly acting as tenant X choosing channel A over B is not escalating privilege.

**Row-level security stays keyed on `tenant_id` only.** No policy references channel. Adding one would imply channels within a tenant distrust each other, which is not the model.

Seam: when authentication lands, an operator may need scoping to a subset of channels. That is *authorization*, not *isolation*.

### 2. Scope travels in both the URL and a header — with the header as the only trust input

Cacheability and trust are different problems and are solved by different mechanisms.

- **URL** (`/api/{tenant}/{channel}/…` on cacheable reads) is a **cache key**. Every cache in the chain — browser, CDN, Next — keys on it with no configuration.
- **Header** (`x-tenant-id`, `x-channel-id`) is the **trust input**, injected by the gateway from validated claims.

Today no shared cache stores these responses at all: the api answers GET with `cache-control: private, max-age=0`, which forbids CDN storage outright, and Next's data cache — the only cache in play — already keys on the full URL plus request headers. So the CDN argument is about intent, not the current deployment. URL scoping is adopted now for two reasons. Retrofit asymmetry: changing the URL shape after integrations, bookmarks and cache keys depend on it is brutal, while carrying scope from the start costs little. And honesty about where this is going: if shared caching is ever enabled — a separate decision with its own security analysis, because it means replacing `private` — correctness must not rest on per-CDN handling of `Vary` over custom headers, which ranges from ignoring it (serving one tenant's response to another, at a layer the application cannot observe) to refusing to cache. [CAVEATS](../CAVEATS.md) already records cross-tenant cache serving as the worst failure available here.

**The security rule, which is not deferrable:**

> Tenant and channel resolve **from the header only**. The URL segment is then **asserted to match**. A mismatch is rejected (`400`). The URL never establishes identity.

Resolving from the URL would let a crafted path override what the gateway bound — a direct route to another tenant's data during the trust-by-header window. "Prefer the header" is equally wrong: silently picking a winner turns a mismatch into an exploit instead of an error.

`Vary: x-tenant-id, x-channel-id` is still sent — the cache plugin already sends `Vary: x-tenant-id` on **every** GraphQL response, not just GET; the value gains the channel header — as defence in depth for paths that stay header-only.

### 3. Configuration is replicated by event and reconciled — never queried per write

Modules storing `channel_id` must validate it. Calling the `channels` contract on every write is clean in-process and becomes a **distributed monolith** on extraction: every module blocking on one hub whose availability caps the system.

Channel data is configuration — low cardinality, rarely changed, read constantly. Configuration is replicated.

- `channels` publishes `channels.created`, `channels.updated`, `channels.archived`, `channels.tenant-defaults.updated` — module-prefixed like every existing event (`catalog.product.created`, `pricing.tenant-config.updated`, `orders.created`).
- Consumers hold a local read-model of *resolved* channel configuration.
- **Lazily populated**, not loaded at boot: a boot-time load becomes a network call during startup after extraction, so a channels outage would prevent the whole system starting — strictly worse than what the pattern was introduced to avoid.
- A **miss** falls through to a read-through contract call: slow, never wrong.
- A **stale hit** is the dangerous case and read-through does not cover it. The in-process bus has no durability, retry or replay, so a dropped `channels.archived` leaves a consumer confidently wrong with nothing detecting it. **Periodic reconciliation plus a TTL closes the loop.** At single-digit channels per tenant, full reload on an interval is proportionate.
- Reconciliation runs on a timer with no request, so no `app.tenant_id` is bound and RLS would show it zero rows — a reload that reads nothing and reports success, the exact `0 = 0` failure this project has already shipped once. The `audit.webhook_outbox` policy solved this with an explicit `app.system_worker` setting, deliberately narrower than BYPASSRLS; the channels tables carry the same clause for the same reason, and the reconciliation check asserts a **non-zero** reload count.

Extraction then changes the transport of events, not the call graph.

### 4. Identifiers: a UUID for references, a key for humans, and the key stops moving

`id` is an immutable UUID and is what every other module stores. `key` is the human and integration handle, unique per tenant.

**`key` is immutable once the channel leaves `draft`.** Mutable identifiers must never be foreign references, and a key that appears in URLs, integration configuration and cached paths is a foreign reference whether or not the database treats it as one. `name` carries all display mutability — which is the rename operators actually want.

### 5. `currency_code` is immutable once a channel has transacted

Changing it silently reinterprets history: existing orders hold minor-unit integers whose meaning depended on the old currency; aggregates cross a currency boundary; unrestated prices are wrong by an exchange rate. Order snapshots protect *rendering*, not aggregation or reconciliation.

Changing a market's currency is a new-channel operation, not an edit.

Enforced across a module boundary without a query: `orders` already publishes `orders.created` (payload: the full order, which gains `channel_id` in this slice); `channels` consumes it and sets `has_transacted`. The invariant is then local. `country` (tax jurisdiction) warrants at least a confirmation step on the same reasoning.

### 6. Channel configuration inherits from tenant defaults

Every field being concrete per channel means fifteen European markets are fifteen hand-maintained copies, where a tax-display policy change is fifteen edits and one missed channel is a compliance incident.

Channel fields are **nullable, meaning inherit** from a per-tenant defaults row; the effective configuration is the coalesce. This keeps the create-a-channel form short, makes a policy change one edit, and preserves the distinction between "set deliberately" and "happens to equal the default" — which is impossible to recover once every row holds a concrete value.

The contract therefore exposes two types: the stored `Channel` and the resolved `ChannelConfig`. Consumers cache the resolved form.

### 7. `Query.capabilities` becomes channel-aware — a breaking change to a consumed surface

The first change here to alter an API surface a shipped storefront reads. Expand/contract:

1. Add channel-scoped fields alongside tenant-level ones, which continue to answer by resolving the tenant's default channel. Mark the old fields `@deprecated` so codegen and the drift check surface the migration rather than a document carrying it alone.
2. Migrate the storefront.
3. Remove the deprecated fields in a separate commit.

Channel semantics live in the `channels` contract: `ChannelService` is the one resolver of "what configuration applies here". The capabilities surface itself stays where it is — the composition root — because it also reports `apiVersion` and the deployment's feature map, which are composition facts no domain module should own. It composes from the channels contract exactly as it consumes pricing's `TENANT_CONFIG_QUERY` today; what disappears is its direct read of pricing config.

### 8. Every tenant gets a default channel, and the missing-header fallback has an expiry

The migration creates one channel per tenant from its current configuration, marked default. Requests omitting the channel resolve to it, which keeps the shipped storefront working unchanged.

An unknown, archived, or cross-tenant channel **fails loudly (`404`) and never falls back** — silent fallback means a typo serves the wrong market's prices and looks like it worked.

The *missing-channel* fallback is a migration affordance with a stated expiry: once the storefront sends channel scope, it becomes required. An undated fallback becomes permanent, and permanent means a misconfigured integration silently transacts in the wrong currency.

### 9. This decision does not deliver multi-currency

A channel carrying one currency is one currency per channel. Multi-currency is a separate, larger decision requiring price rows per currency; a policy on runtime FX conversion (the correct enterprise answer is almost always *no* — fixed price lists, because converted amounts round unpredictably and do not reconcile); per-currency rounding; and defined behaviour when a price is missing in a channel's currency (fail — falling back to another currency's number is a money bug).

### 10. This decision delivers locale *formatting*, not localized *content*

`default_locale` and `supported_locales` drive dates, numbers and currency symbols. They do not deliver translated content, because the catalog has no locale dimension — product names, descriptions and attribute labels are single-valued. A channel declaring `de-DE` renders German formatting around English copy.

Localized content is a **catalog** change: a translations model on product fields and attribute definitions, a fallback chain, and per-language analyzers in search (a German index needs German stemming, which likely means per-locale fields or indices). Comparable in size to per-channel pricing, and it touches the hero feature.

Stated plainly so the back office does not ship a locale picker implying a capability that does not exist.

### 11. Tax is deliberately simplified, with a named seam

One rate per channel cannot express per-product tax classes, destination-based US sales tax, EU OSS thresholds, or B2B reverse charge. For this stage one rate is a reasonable simplification; it is only defensible as a *stated* one. The seam: a `tax_class` on products and a tax-provider interface a channel selects, making the stored rate a fallback rather than the model.

`tax_display` (gross/net) is **not** presentation, and this slice commits to making it real rather than trimming it. The pricing engine today computes net-only — subtotal, discount, tax added on top — and `capabilities` hardcodes `EXCLUSIVE` with a comment stating that is how the engine works. A per-channel `tax_display` therefore requires the engine to learn tax-inclusive computation (deriving base and tax out of a gross price, with its own rounding rules under [ADR-0005](0005-money-as-integer-cents-bankers-rounding.md)), not just a column and a dropdown. That work is in scope and sequenced (backlog C-29..C-31), with the engine change landing **before** the field becomes editable — a control wired to nothing would let an operator select gross and silently serve net, which is worse than no control. It is an EU legal requirement differing between B2C and B2B: compliance, not preference.

### 12. Per-channel pricing and catalogue scope are not in this decision

The model admits them; this slice does not build them. Per-channel pricing has a sharp consequence for the denormalised price copy in the search index and needs its own record. See `docs/design/CHANNEL-MODEL.md` §7.

### 13. Authentication sequencing

The back office that surfaces channels is the artefact that makes authentication non-optional: an admin console reached without identity is not defensible even in a demo, and [0007](0007-tenant-id-as-trust-gateway-responsibility.md) already assigns authentication to the gateway, so building it executes an existing decision rather than adding architecture.

It also closes two current gaps: audit entries gain an actor, and operator-scoped channel permissions become expressible. High-blast-radius configuration changes with no attributable actor are close to unauditable.

**Decided (G-1, 2026-08-28): authentication is a prerequisite slice, scoped to the minimum that is not a lie.**

The scope is what [0007](0007-tenant-id-as-trust-gateway-responsibility.md) already specifies the gateway does and nothing more: authenticate an operator, resolve the authorised tenant from the claim, inject `x-tenant-id`, and strip any the client sent. That fourth step does not exist today, so the ADR currently describes a topology the repository does not have — with or without a back office.

Deliberately **out** of that slice: permission matrices, user-management screens, password flows, SSO federation. One operator role. The identity provider stays configuration, the same way the Kubernetes manifests leave the cluster to the deployment — what gets built is the seam, and the seam is exercised rather than described.

Two reasons this is a prerequisite rather than a gate. An admin console reached without identity reads as a toy to exactly the audience this project addresses, and the Kubernetes manifests already expose the console through an Ingress. And an undated gate becomes permanent — the argument §8 makes about the missing-channel fallback applies with more force to an unauthenticated console.

The auth slice gets its own ADR (0015) covering the implementation choices this one does not settle: dev issuer versus a real IdP, session mechanism, and where the gateway runs. That ADR is a prerequisite for C-20, not for C-1.

---

## How this gets checked

House rule: state what the check prints if the change did nothing.

| Property | Negative control |
|---|---|
| Channel resolution | **Two** channels with different currencies; assert responses differ. One channel passes even if resolution is hardcoded to default. |
| Cache separation | Two channels, one tenant, same read, in sequence. Without URL scoping and `Vary`, the second returns the first's currency. |
| URL/header agreement | Request with header tenant A and URL tenant B. Anything but a rejection means the assertion is not wired. |
| Config replicated, not queried | Stop publishing `channels.created`; a write referencing a new channel must still succeed via read-through. |
| Staleness closed | Drop a `channels.archived` event; assert the consumer rejects writes to it within the staleness budget. Without reconciliation the write succeeds forever and no existing test notices. |
| Backfill | Run as the **non-superuser** role with rows visible; assert non-zero tenants and exactly one default each. A previous backfill reported `0 = 0` as success because RLS hid the source rows. |
| Expand/contract | Deprecated and channel-scoped fields return the same value for the default channel; a second tenant with a different currency makes a constant-wired alias diverge. |
| No RLS on channel | Assert two channels in one tenant are **both** visible to that tenant. |
| Default promotion race | Two concurrent promotions; assert one wins cleanly rather than an intermittent constraint violation. |

## Links

- [docs/design/CHANNEL-MODEL.md](../design/CHANNEL-MODEL.md) — the model, mechanics, and back-office shape
- [docs/BACKLOG-channels.md](../BACKLOG-channels.md) — the build sequence and gates G-1..G-3
- [apps/api/src/capabilities.module.ts](../../apps/api/src/capabilities.module.ts) — the surface §7 evolves; the `taxDisplay` hardcode §11 removes
- [packages/shared/security/src/db/migrations/0004_webhook_outbox_rls.sql](../../packages/shared/security/src/db/migrations/0004_webhook_outbox_rls.sql) — the `app.system_worker` pattern reconciliation adopts
- [packages/modules/branding/](../../packages/modules/branding/) — module layout and migration precedent
