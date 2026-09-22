# Channels slice — what it delivers, and why it is shaped this way

Read this first. [ADR-0014](../adr/0014-channel-as-sales-channel.md) is for interrogating any single decision; [CHANNEL-MODEL](CHANNEL-MODEL.md) is for building; [BACKLOG-channels](../BACKLOG-channels.md) is for sequencing — and its top section is the **current status**. [CHANNELS-BUILD-NOTES](CHANNELS-BUILD-NOTES.md) holds the traps and mistakes found while building. This is the layer above all of them.

**The one-sentence version:** a tenant stops being a single market and becomes a business selling into several, with an admin console to configure them and an API that reports what each one is.

Branch: `channels`. Status: Phases A–C built and verified; gate G-4 closed 2026-09-22 (see §3); Phases D–H pending.

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

### Decided while building

Made in code between 2026-08-28 and 2026-09-22, each recorded in its backlog row and commit. **Three are product decisions awaiting the user's confirmation** (marked ⚑); the rest follow from the design.

| Decision | Why | Row |
|---|---|---|
| ⚑ Nothing returns to `draft` | Otherwise `key` immutability is circumventable: archive, redraft, rename, reactivate | C-8a |
| ⚑ `archived → active` is allowed | A market can reopen, and forbidding it makes a mis-archive unrecoverable; safe because the key is already frozen | C-8a |
| ⚑ `x-channel-id` carries the channel **key**, not its UUID | A header is an integration surface; `x-tenant-id` carries `t-fashion`, not a surrogate. The ADR's header name is kept | C-12 |
| Invariant violations are returned **all at once** | The back office edits a whole channel in one form; first-error-wins turns one round trip into four | C-8a |
| Invariants live in a **service above the repository**, behind a `ChannelStore` port | Rules and persistence meet in one place, and the rules are provable while the SQL is not | C-8b |
| `If-Match` is **required**; absent is `400` | Optional optimistic concurrency stops applying to exactly the client that forgot it | C-10 |
| An ETag comes from **the same read** as the body | Two reads let a concurrent write make them disagree | C-9 |
| The `{channelKey}` URL segment waited for channels to exist | A segment that resolves against nothing accepts any key | C-2b |
| `Vary` names `x-channel-id` even though scoped reads carry the key in the URL | The header-only `/graphql` path still exists and still honours the header | C-4 |
| Events publish **after** commit; `archived` is its own event; tenant-defaults is **one** event, not one per channel | A consumer must find what it was told about; an `updated`-only subscriber must not keep serving a closed market; a fan-out is a thundering herd on one click | C-13 |
| The read-model lives in `contracts/`; misses are **not** cached; `listActive` never answers from the replica | One implementation for every consumer; a cached null outlives the channel it hid; a partial replica cannot answer a completeness question | C-14 |
| `CHANNEL_QUERY` is defined in `contracts/`; `ChannelsModule` is `@Global` | The boundary rule forbids a consumer importing the provider's `src` | C-16a |
| Reconciliation binds `app.system_worker`, **refuses a zero-row reload**, and swaps atomically | A timer has no tenant; a blinded read must not wipe a warm replica; no request should see it half-built | C-15 |
| Orders **copy** the channel's id, key, name and exponent | A rename or archive must not rewrite history | C-16a |
| Backfilled orders get a `channel_id` but **null** key and name | There was no historical name to record; borrowing today's would be indistinguishable from a real snapshot | C-16a |
| The pricing seed **derives** currency and tax from the channel fixtures | The two copies had drifted | C-16a |
| A cart stores the **concrete** default channel id, never "default" | A basket must not change market when another channel is promoted | C-16b |
| A cart used in the wrong channel is `400`, not `404` or `409` | Channels are not a trust boundary; `409` means a version conflict here | C-16b |
| The transacted mark binds its tenant **from the event** and does **not** bump `version` | The bus is asynchronous; a bump would `409` an operator's unrelated edit | C-17 |
| `taxMode` is an engine **input**, not a response field | `capabilities.taxDisplay` already says how to read prices | C-29 |
| A tenant with no channel gets one default keyed `web`, inheriting everything | It exists only so a database that skipped a re-seed still works; the seed replaces it | C-11 |
| An unservable channel is refused with **`422`**, code `channel.unservable`, naming the channel and both currencies | The request is well formed and the channel real, so not `400` or `404`; `409` means a version conflict here, and a client retrying it would loop | C-32a |
| Migrations lift RLS with `NO FORCE` on their own tables, and through `app.system_worker` on another module's | A migration runs as the owner and FORCE applies to the owner; where another module's policy already admits a system reader, its RLS is not altered from outside | C-11, C-33 |

---

## 3. Gates — three closed 2026-08-28, the fourth 2026-09-22

| Gate | Question | Decision |
|---|---|---|
| **G-1** | Auth: prerequisite, or gate with expiry? | **Prerequisite, minimum scope.** Four gateway behaviours, one operator role, IdP left as configuration. Needs ADR-0015 before C-20 |
| **G-2** | URL scoping shape? | **`/api/{tenant}/{channelKey}/graphql`**, segment omitted for the default, reads only |
| **G-3** | Country/timezone for existing tenants? | **Neither option.** The seed writes real values; the migration keeps a trivial safety backfill |
| **G-4** | What does a channel charge when its currency differs from the price list's? | **Refuse now, price lists later** (2026-09-22). Opened 2026-09-19: prices are one currency-less integer per product and checkout charges the tenant's currency regardless of channel. ADR §9 says *fail*; §12 defers per-channel prices. C-32 refuses to price a channel the price list cannot serve — carts, checkout and price reads; per-channel price lists become Phase H with their own ADR |

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

And one thing the reconciliation itself missed, found only while building (2026-09-19):

- **No row charged a channel's currency.** The drafts give a channel a `currency_code` and never assign anyone to make totals or checkout use it. The reconciliation did not notice, and the gap was then misattributed to C-18 (capabilities-only) in six places. An order in `t-fashion`'s EUR channel is charged GBP. Opened as gate **G-4**; see §3.

---

## 5. Honest limits

Stated here so the back office does not ship a control implying a capability that does not exist.

- **One currency per channel.** Not multi-currency.
- **A channel's currency is declared, not yet charged.** Checkout charges the tenant's price-list currency regardless of channel, until C-32 lands (gate G-4 chose to refuse such a channel; per-channel price lists come later). For the two single-channel demo tenants the two agree; for `t-fashion`'s `de` they do not.
- **Formatting, not translation.** A `de-DE` channel renders German number formats around English product copy.
- **One tax rate per channel.** No tax classes, no destination-based US tax, no EU OSS, no B2B reverse charge.
- **Cache entries multiply by channels per tenant.** Fine at single digits, worth watching if channels proliferate.
- **Gross pricing is real but sequenced last** (Phase G). Until C-30 lands, `tax_display` reports `net` because that is what the engine does.

## 6. Not in this slice

Per-channel prices · catalogue scope / product selection · localized content · per-channel themes · payment methods · inventory and `InventorySource` · storefront domain binding · operator-scoped permissions · true multi-currency · data residency · bulk import/export · the operations portal.

---

## 7. Effort

≈ 9–11.5 weeks for one experienced engineer, excluding the auth slice (a further ≈ 1–1.5). Ranges, not commitments. Breakdown in [CHANNEL-MODEL §12](CHANNEL-MODEL.md#12-effort).
