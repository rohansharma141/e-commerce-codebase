# Channels slice — what it delivers, and why it is shaped this way

Read this first. [ADR-0014](../adr/0014-channel-as-sales-channel.md) is for interrogating any single decision; [CHANNEL-MODEL](CHANNEL-MODEL.md) is for building; [BACKLOG-channels](../BACKLOG-channels.md) is for sequencing. This is the layer above all three.

**The one-sentence version:** a tenant stops being a single market and becomes a business selling into several, with an admin console to configure them and an API that reports what each one is.

Branch: `channels`. Status: designed, gates closed, nothing built yet.

---

## 1. What this delivers

### Operator-facing

| Capability | What an operator can actually do | Phase |
|---|---|---|
| **Sales channels** | Run several selling contexts under one tenant — a UK store in GBP, a German one in EUR — each with its own currency, locales, country, timezone and tax rate | B |
| **Channel lifecycle** | Prepare a market as `draft` before exposing it, activate it, archive it when it closes. Existing orders keep working; the default cannot be archived | B |
| **Configuration inheritance** | Set a baseline once at tenant level; channels inherit unless deliberately overridden. A policy change is one edit, not fifteen — and "inherited" stays distinguishable from "happens to match" | B |
| **Back office** | A real admin console: log in, switch tenant, switch channel, edit tenant defaults, create / edit / archive channels, promote a default | E |
| **Safe concurrent editing** | Two operators editing one channel do not silently overwrite each other — the second gets a conflict. Immutable fields render disabled with the reason, rather than failing after submit | B, E |
| **Gross / net pricing** | Choose tax-inclusive (European) or tax-added (US) presentation per channel — with the pricing engine actually computing it, not just labelling it | G |
| **Attributable changes** | Configuration changes carry an actor, so a currency or tax edit is auditable | Auth slice |

### Integrator-facing

| Capability | What changes | Phase |
|---|---|---|
| **Channel-scoped reads** | `/api/{tenant}/{channelKey}/graphql` — the same catalogue returns that channel's currency, formatting and tax | A, C |
| **Self-description per channel** | `capabilities` reports the *resolved* channel configuration, so a client discovers currency and minor units rather than being configured with them | D |
| **Consistent admin surface** | Cursor pagination, one error envelope, `ETag` / `If-Match` concurrency, idempotent creates — applied across the existing endpoints, not only new ones | A |
| **Channel on commerce records** | Carts are channel-bound; orders snapshot the channel's id, key, name, currency and exponent, so a later rename or archive does not rewrite history | C |
| **Currency integrity** | A channel's currency freezes once it has transacted — changing it would silently reinterpret every existing order's minor-unit integers | C |

### Storefront

Channel-scoped reads with correct cache separation — a UK shopper cannot be served the German channel's EUR prices from a warm cache — and prices rendered from the channel's capabilities rather than hardcoded assumptions.

### Enabling architecture

Not user-visible, and most of the work.

- **Configuration replicated by event, not queried per write.** Each consuming module holds a local read-model, lazily populated, read-through on a miss, periodically reconciled.
- **Scope resolution with a hard security rule.** Tenant and channel resolve from the header only; the URL segment is asserted to match and a mismatch is rejected.
- **A real authentication gateway** — the four behaviours [ADR-0007](../adr/0007-tenant-id-as-trust-gateway-responsibility.md) has specified since May and nothing has implemented.
- **A third deployable** (`apps/back-office/`) on a different stack, which incidentally demonstrates the API is client-agnostic rather than shaped around Next.

---

## 2. Decision register

Every decision in this slice, with the reason compressed to one line. Full argument in ADR-0014 at the section given.

### What a channel is

| Decision | Why | Where |
|---|---|---|
| `Channel` means **sales channel** and nothing else | "Where you sell" and "where stock lives" share an id and a name and nothing else | ADR Decision |
| Supply is **not** modelled; inventory will bring `InventorySource` | A physical store that sells and holds stock is a channel *and* a source, not one row wearing two hats | ADR Decision |
| **Rejected:** one entity with a `roles` array | Field sets barely overlap, so roles force either meaningless-nullable columns or a JSON blob. Retrofit is asymmetric: adding `InventorySource` later costs nothing, unpicking a shared table that catalog, pricing and orders query costs a great deal | ADR Alternatives |
| Owned by a new `channels` module — own schema, no cross-module FKs | Same module discipline as every other domain | ADR Decision |

### Isolation, trust and scope

| Decision | Why | Where |
|---|---|---|
| RLS stays keyed on `tenant_id` only; **no channel policy** | Channel is scope selection *within* an already-resolved tenant. A policy would imply channels distrust each other, which is not the model | §1 |
| Scope travels in **both** URL and header; only the header is trusted | Cacheability and trust are different problems. Resolving from the URL would let a crafted path override what the gateway bound | §2 |
| URL/header mismatch is rejected (`400`), never reconciled | "Prefer the header" turns a mismatch into an exploit instead of an error | §2 |
| Grammar: `/api/{tenant}/{channelKey}/graphql`, segment omitted for the default | `/api` is reserved because tenant ids match `[a-zA-Z0-9._-]{1,64}` — which admits `admin`. Omitting beats a sentinel because `default` is a key an operator may want | §2 (G-2) |
| Scope segments on **reads only** — admin and system stay header-only | Admin manages channels; scoping a channel-management call to a channel is theatre. A uniform external grammar is a gateway rewrite, not an API change | §2 (G-2) |
| Reconciliation binds `app.system_worker` | A timer has no bound tenant, so RLS would feed it zero rows and it would report success having read nothing — this project's `0 = 0` scar | §3 |

### Model

| Decision | Why | Where |
|---|---|---|
| Two identifiers: immutable UUID `id`, human `key` | `id` is what other modules store; `key` is what humans and integrations use | §4 |
| `key` immutable once past `draft` | It appears in URLs, integration config and cache paths — a foreign reference whether or not the database says so | §4 |
| `currency_code` immutable once the channel has transacted | Changing it silently reinterprets existing orders' minor-unit integers; snapshots protect rendering, not aggregation | §5 |
| Channel fields nullable, meaning **inherit** from tenant defaults | Fifteen European markets should not be fifteen hand-maintained copies where one missed edit is a compliance incident | §6 |
| Two contract types: stored `Channel`, resolved `ChannelConfig` | Consumers cache the resolved form; the back office edits the stored form and shows what is inherited | §6 |
| Currency exponent **derived** for config, **stored** on snapshots | An editable per-channel exponent permits GBP-with-exponent-0. An order must render as charged even if standards change | Model §1 |
| Optimistic concurrency via `version` | Two operators editing one channel otherwise lose each other's changes silently — invisible with one operator, routine with two | Model §1 |

### Surfaces and compatibility

| Decision | Why | Where |
|---|---|---|
| `capabilities` becomes channel-aware but **stays in the composition root** | It also reports `apiVersion` and the deployment feature map — composition facts no domain module should own. Only its source changes, from a direct pricing read to the channels contract | §7 |
| Expand / contract: channel-scoped fields added, tenant-level fields `@deprecated`, removal a separate commit | First change to an API surface a shipped storefront reads | §7 |
| Every tenant gets a default channel; a **missing** channel resolves to it | Keeps the shipped storefront working unchanged | §8 |
| An **unknown, archived or cross-tenant** channel is `404` and never falls back | Silent fallback means a typo serves the wrong market's prices and looks like it worked | §8 |
| The missing-channel fallback carries a **stated expiry** | An undated fallback becomes permanent, and permanent means a misconfigured integration silently transacts in the wrong currency | §8 |

### Scope boundaries

| Decision | Why | Where |
|---|---|---|
| This does **not** deliver multi-currency | One currency per channel. Real multi-currency needs price rows per currency, an FX policy (the enterprise answer is almost always *no runtime conversion*), per-currency rounding, and defined behaviour when a price is missing | §9 |
| Locales drive **formatting**, not localized content | The catalog has no locale dimension. A `de-DE` channel renders German formatting around English copy. Translation is a catalog change touching the hero feature | §10 |
| `tax_display` is made **genuinely editable**, with the engine work in scope | The engine computes net-only today. A control wired to nothing would let an operator select gross and silently serve net — worse than no control. Sequenced engine → field → storefront | §11 (A1) |
| Tax stays one rate per channel, with a named seam | Cannot express tax classes, US destination-based tax, EU OSS or B2B reverse charge. Defensible only as a *stated* simplification | §11 |
| Per-channel pricing and catalogue scope deferred to their own ADR | Per-channel pricing breaks the denormalised price copy in the search index, and the major/minor conversion stops being constant | §12 |
| Authentication is a **prerequisite slice** at minimum scope | An admin console without identity reads as a toy, the manifests expose it through an Ingress, and an undated gate becomes permanent. Scope is the four gateway behaviours ADR-0007 already specifies | §13 (G-1) |

### Process

| Decision | Why |
|---|---|
| The seed owns channel fixtures; no derivation, no review flag | The tenants are fixtures we generate. Careful data-preservation machinery for regenerable rows is the wrong instinct (G-3) |
| `t-fashion` seeds **two** channels, GBP and EUR | The channel-resolution control is "two channels with different currencies; assert responses differ". Three identical single-channel tenants cannot fail it |
| The existing Nest error envelope is kept, not replaced | Replacing it breaks every endpoint and the storefront's error handling for no gain |
| Cursor pagination extends `GET /admin/products`' existing shape | It already exists; C-1 adopts it rather than choosing a convention |
| Idempotency extraction is its own item (C-28) | The mechanism is private to `checkout.service.ts` with its own table — "reuse" means extract first |
| Only Phase A is sized; later phases sized when next up | BACKLOG.md's rule is XS/S/M with nothing larger, split *before* starting |

---

## 3. Gates, closed 2026-08-28

| Gate | Question | Decision |
|---|---|---|
| **G-1** | Auth: prerequisite, or gate with expiry? | **Prerequisite, minimum scope.** Four gateway behaviours, one operator role, IdP left as configuration. Needs ADR-0015 before C-20 |
| **G-2** | URL scoping shape? | **`/api/{tenant}/{channelKey}/graphql`**, segment omitted for the default, reads only |
| **G-3** | Country/timezone for existing tenants? | **Neither option.** The seed writes real values; the migration keeps a trivial safety backfill |

G-1 was the only gate that could change the slice's size, and it did — an auth slice now precedes Phase E. G-3 went the other way: it removed machinery *and* improved the verification.

---

## 4. What the drafts got wrong

The three documents were written without repository access and said so. Reconciled 2026-08-28 (commit `3df50c1`). Recorded because the corrections explain why several sections read as they do:

- `orders` publishes **`orders.created`**, not `order.placed`, and already publishes it.
- Columns are **`tax_rate_bps`** and **`currency`**.
- **`tax_display` and `supported_locales` have no source anywhere** — capabilities hardcodes one and derives the other.
- **Cursor pagination already exists**; the error envelope already exists; idempotency is service-private.
- The **CDN argument for URL scoping was written against a threat this deployment does not have** — GET answers `cache-control: private`, so no shared cache stores anything. Rewritten as retrofit asymmetry plus stated intent.
- **Reconciliation would have read zero rows under RLS** and reported success.
- The word `channel` is **unused** in the codebase — the collision worry was unfounded.

---

## 5. Honest limits

Stated here so the back office does not ship a control implying a capability that does not exist.

- **One currency per channel.** Not multi-currency.
- **Formatting, not translation.** A `de-DE` channel renders German number formats around English product copy.
- **One tax rate per channel.** No tax classes, no destination-based US tax, no EU OSS, no B2B reverse charge.
- **Cache entries multiply by channels per tenant.** Fine at single digits, worth watching if channels proliferate.
- **Gross pricing is real but sequenced last** (Phase G). Until C-30 lands, `tax_display` reports `net` because that is what the engine does.

## 6. Not in this slice

Per-channel prices · catalogue scope / product selection · localized content · per-channel themes · payment methods · inventory and `InventorySource` · storefront domain binding · operator-scoped permissions · true multi-currency · data residency · bulk import/export · the operations portal.

---

## 7. Effort

≈ 9–11.5 weeks for one experienced engineer, excluding the auth slice (a further ≈ 1–1.5). Ranges, not commitments. Breakdown in [CHANNEL-MODEL §12](CHANNEL-MODEL.md#12-effort).
