# Channel model and back-office shell — design note

Companion to [ADR-0014](../adr/0014-channel-as-sales-channel.md). The ADR decides *what a channel is*; this note works out the model, the mechanics, and the shape of the back office that surfaces it.

## 1. Entities

New module `channels`, own schema `channels`. Two tables: per-tenant defaults, and channels that inherit from them.

```
channels.tenant_defaults
  tenant_id           text primary key
  currency_code       text not null              -- ISO 4217
  default_locale      text not null              -- BCP 47
  supported_locales   text[] not null            -- BCP 47
  country             text not null              -- ISO 3166-1 alpha-2
  timezone            text not null              -- IANA
  tax_display         text not null              -- gross | net
  tax_rate_bps        integer                    -- interim; null once a tax provider lands
  version             integer not null default 1
  created_at, updated_at

channels.channels
  id                  uuid primary key default gen_random_uuid()
  tenant_id           text not null              -- RLS key
  key                 text not null              -- immutable once status leaves 'draft'
  name                text not null              -- freely mutable, display only
  status              text not null              -- draft | active | archived
  is_default          boolean not null default false
  has_transacted      boolean not null default false   -- set by orders.created
  version             integer not null default 1       -- optimistic concurrency

  -- all nullable: null means inherit from tenant_defaults
  currency_code       text
  default_locale      text
  supported_locales   text[]
  country             text
  timezone            text
  tax_display         text
  tax_rate_bps        integer

  external_ref        text                       -- ERP/OMS/PIM mapping
  created_at, updated_at
```

Conventions carried over from `branding`, the closest precedent: the Postgres schema itself is created by the shared migrator (`CREATE SCHEMA IF NOT EXISTS`), not by a migration; migrations are hand-written SQL split as `0001_init.sql` / `0002_rls.sql` under `src/db/migrations/`; a Drizzle `src/db/schema.ts` mirrors the tables with `pgSchema('channels').table(...)`; packages are `@platform/channels-contracts` and `@platform/channels-src`. RLS follows the house shape — `ENABLE` + `FORCE`, `CREATE POLICY tenant_isolation ... USING (tenant_id = current_setting('app.tenant_id', true))` with the matching `WITH CHECK` — plus the `app.system_worker` clause on these tables, because reconciliation reads them with no bound tenant (§4).

### Two identifiers, two jobs

`id` is the immutable surrogate — **what every other module stores**. `key` is the human and integration handle, unique per tenant, and **immutable once the channel leaves `draft`**.

A key appears in URLs, integration configuration and cached paths; that makes it a foreign reference whether or not the database treats it as one. Renaming it orphans callers, or worse, silently resolves to a different market if the old key is later reused. `name` carries all display mutability.

Orders snapshot the channel's **id, key, name, currency and exponent at time of purchase** — display facts that must survive a later rename or archive.

### Currency exponent is derived for config, stored for snapshots

The exponent (2 for GBP, 0 for JPY) is a property of the currency under ISO 4217, not of the channel. An editable per-channel copy permits GBP-with-exponent-0, making every price on that channel wrong by a factor of one hundred.

- **Config derives** — resolve from a currencies reference table or `Intl.NumberFormat`. One source of truth.
- **Snapshots store** — an order records the exponent it was charged at, because it must render as charged even if standards change.

Different rules for different lifetimes. Applying the config rule to snapshots loses history; applying the snapshot rule to config creates a writable duplicate of a standard.

### Resolved configuration is a distinct contract type

`Channel` is the stored row, with nulls meaning inherit. `ChannelConfig` is the coalesce of channel over tenant defaults — fully populated, no nulls. Consumers cache `ChannelConfig`; the back office edits `Channel` and shows which values are inherited.

A change to `tenant_defaults` changes every channel's resolved config, so it publishes `channels.tenant-defaults.updated` and invalidates the tenant's entries wholesale.

### Constraints and invariants

Enforced in the database:

- `unique (tenant_id, key)` — keys unique per tenant, not globally.
- `unique (tenant_id) where is_default` — exactly one default per tenant. The default is what unspecified requests fall back to; an application-only guarantee fails open.

Enforced in the repository, each with a test:

- The default channel must be `active` and **cannot be archived**; archiving requires promoting another first.
- **At least one active channel per tenant.** Nothing in DDL guarantees one exists; a tenant with zero resolves no requests, and the failure surfaces at request time rather than at the operation that caused it.
- `key` immutable once `status != 'draft'`.
- `currency_code` immutable once `has_transacted`.
- **Promoting a default is two writes** (unset old, set new) racing the partial unique index. One transaction, deterministic order, plus a test running two promotions concurrently — otherwise the failure is an intermittent constraint violation in production and nowhere else.

RLS: `tenant_id` only. No channel policy — see the ADR.

### Optimistic concurrency

`version` increments on every write. Mutations carry the expected version and return `409 Conflict` on mismatch — surfaced as `ETag` / `If-Match` on REST and as a required input field on GraphQL mutations.

Without it two operators editing the same channel silently lose one another's changes: invisible with one operator, routine with two, and near-impossible to retrofit once clients assume last-write-wins.

---

## 2. Scope resolution — URL and header together

Both mechanisms, doing different jobs:

- **URL** on cacheable reads: `/api/{tenant}/{channelKey}/graphql`, or `/api/{tenant}/graphql` for the tenant default. A cache key that every cache in the chain honours without configuration. `/api` is reserved because tenant ids may be `admin`; the segment carries the key, not the id; admin and system routes take no scope segment (ADR §2).
- **Header**: `x-tenant-id`, `x-channel-id`, injected by the gateway from validated claims. The trust input.

**The rule that is not deferrable:**

> Resolve tenant and channel **from the header only**. Assert the URL segment matches. Mismatch → `400`. The URL never establishes identity.

Resolving from the URL would let a crafted path override the gateway's binding. "Prefer the header" is equally wrong — silently picking a winner turns a mismatch into an exploit rather than an error.

Resolution runs in the existing tenant-context middleware and rides the same `AsyncLocalStorage` — a field on the existing context, not a parallel mechanism.

Unknown, archived, or cross-tenant channel → `404`. Missing channel → tenant default, **with a stated expiry**; once the storefront sends scope on every call, it becomes required.

---

## 3. Cache correctness

Storefront reads are `GET /graphql`, cached by Next; tenants are separated today by the `x-tenant-id` header in the cache key plus `Vary: x-tenant-id`.

Adding a channel dimension without extending the key means **every channel in a tenant shares one cache entry** — a UK shopper served the German channel's EUR prices from a site that looks fast and correct.

(The api currently answers `cache-control: private, max-age=0`, so no shared cache stores these responses today; the CDN concern is about the day that changes — see the ADR's §2.)

Required:

- Channel and tenant in the **URL path** for cacheable reads, so the CDN keys correctly regardless of its `Vary` support.
- `Vary: x-tenant-id, x-channel-id` retained as defence in depth. `graphql-cache.plugin.ts` already sends `Vary: x-tenant-id` on **every** response (only `cache-control` is GET-scoped); the value gains the channel header.
- Both headers sent on **every** storefront fetch.
- `api-graphql.spec.ts` — which already fails if the method reverts to POST or the tenant header is dropped — extended for the channel header and the URL scoping.

Note the cardinality cost: cache entries multiply by channels per tenant. Acceptable at single digits; worth watching if channels proliferate.

---

## 4. Validation without a synchronous hub

Every module storing `channel_id` must validate it. Calling the contract per write becomes a distributed monolith on extraction.

- Each consuming module holds a local read-model of `ChannelConfig` per tenant.
- **Populated lazily, not at boot.** A boot-time load becomes a startup network call after extraction, so a channels outage would stop the whole system starting — worse than the problem being solved.
- **Miss → read-through** contract call. Slow, never wrong.
- **Stale hit → reconciliation.** The in-process bus is `queueMicrotask` with no durability, retry or replay, so a dropped `channels.archived` leaves a consumer confidently wrong and finding an entry, so never falling through. Periodic full reload plus a TTL closes it; at single-digit cardinality that is proportionate.

Reconciliation runs on a timer with no request and no bound tenant, so RLS would show it zero rows — success while reading nothing, this project's `0 = 0` scar. The channels tables therefore carry the same explicit `app.system_worker` clause as `audit.webhook_outbox` (that migration documents why it is deliberately narrower than BYPASSRLS), and the reconciliation spec asserts a **non-zero** reload count as its own sanity check.

**Negative controls:** stop publishing `channels.created` and assert a write to a new channel still succeeds (proves read-through). Drop a `channels.archived` and assert the consumer rejects writes within the staleness budget (proves reconciliation).

---

## 5. Admin API conventions — decided here because every later screen inherits them

The existing admin surface was built for a seeder and a storefront. Channels is the first built for an operator, and whatever it does becomes the pattern for catalog, pricing, orders and inventory screens. Decide once:

- **Pagination:** cursor, not offset — offset pagination on a mutating admin list skips and repeats rows. `GET /admin/products` already does this (`limit` + `cursor` → `{ items, nextCursor }`); C-1 adopts that exact shape and extends it to the other list endpoints, which today have `limit` at most and no cursor (orders, prices) or nothing (promotions, attribute-definitions).
- **Filtering and sorting:** a stated query-parameter grammar, applied uniformly.
- **Error envelope:** keep the shape every endpoint already returns — Nest's `{ message, error, statusCode }` — rather than invent a second one; the `409` conflict body extends it with the current `version`. Replacing the envelope would break the storefront's existing error handling for no gain.
- **Partial update:** `PATCH` merge semantics defined — in particular how an explicit `null` (set to inherit) differs from an omitted field (leave alone). This matters immediately because of nullable-means-inherit.
- **Idempotency on creates:** one convention — the `idempotency-key` header checkout already uses, replay returning the original result. The mechanism is currently private to `checkout.service.ts` with its own table in the orders schema, so reuse means **extracting it into shared first** — its own backlog item (C-28), not a C-1 side effect.

None of this is channel-specific, which is why it will be decided by accident if not decided deliberately.

---

## 6. What changes in existing modules

| Module | This slice | Later |
|---|---|---|
| `channels` | new; consumes `orders.created` for `has_transacted` | catalogue scope, payment methods, theme binding |
| shared/tenant-context | header resolution, URL assertion, channel on context | scoped auth claims |
| capabilities surface | moves to `channels`; channel-scoped fields + `@deprecated` aliases | remove aliases |
| storefront read path | URL scoping, both headers, `Vary` | — |
| `catalog` | local read-model | catalogue scope; localized content |
| `pricing` | local read-model | per-channel price rows — §7 |
| `orders` | `channel_id` + snapshot; `orders.created` already published, gains `channel_id` via the order | — |
| `cart` | `channel_id`; carts are channel-bound | — |
| `search` | none | channel filter or per-channel index — §7 |

Orders and cart carry channel **now** even though nothing varies per channel yet: an order created before channels existed is ambiguous forever, and intent cannot be backfilled.

---

## 7. The two deferred problems

### 7a. Per-channel pricing breaks the denormalised price in the search index

[CAVEATS](../CAVEATS.md) records that PDP and browse cards read `attributes.price` from the OpenSearch document — a copy of `pricing.prices`, patched by `pricing.price.upserted`, in **major units** while pricing stores integer minor units. That conversion is already a flagged trap.

One indexed price cannot represent per-channel prices:

- **Index per channel** — clean reads and filtering; multiplies index count and indexing work per price change. Affordable at 33k documents per tenant; not as channels proliferate.
- **Price map on the document** — one index, but range filters and sorts need per-channel fields, so mapping grows a field per channel; OpenSearch dislikes unbounded field counts.
- **Resolve at read from `pricing`** — correct by construction, costs a cross-module read on the hottest path. Already named in CAVEATS as the fix "if the gap ever matters".

Deferred to its own slice and ADR. Sharp edge when built: the exponent now varies per channel, so the major/minor conversion stops being a constant — exactly the shape of bug that multiplies displayed prices by one hundred.

### 7b. Search index scope

Keep **one index per tenant**, filtering by channel when catalogue scope arrives. Move to per-channel indices only when a channel's selection is a small fraction of the tenant's catalogue, at which point filtering wastes more than duplication costs. Stating the threshold matters more than the choice.

---

## 8. Lifecycle

`draft → active → archived`, with rules rather than implications:

- **draft** — configurable, `key` still mutable, not resolvable by any request. Lets an operator prepare a market before exposing it.
- **active** — resolvable; `key` frozen.
- **archived** — not resolvable for new work. Existing carts complete or expire; existing orders keep their snapshot and stay readable.
- The default cannot be archived and must be active.
- A customer switching channels with a populated cart gets an **explicit re-price with the difference shown**, never a silent one. Prices and availability differ by channel; a silent change is a trust failure at the worst moment.

---

## 9. Migration

1. Create schema, both tables, RLS policies, indexes including the partial unique on default.
2. Backfill `tenant_defaults` from each tenant's current currency / locale / tax values.
3. Backfill one channel per tenant: all config fields `null` (inherit), `status = 'active'`, `is_default = true`. Derive `key` from the tenant's country or locale — not the literal `'default'`, which is a plausible key an operator may later want and carries no market meaning.
4. Add nullable `channel_id` to `orders` and `cart`; backfill to the tenant default; tighten to not-null once the write path always sets it.

**Country and timezone have no source in existing data.** Derive where the locale permits (`en-GB` → `GB` / `Europe/London`); otherwise write a documented default and flag the row for operator review. Do not invent silently — a wrong timezone shifts promotion windows and a wrong country shifts tax.

**Two more fields have no source at all.** `pricing.tenant_config` carries exactly `currency`, `locale` and `tax_rate_bps` — there is no stored `tax_display` (capabilities hardcodes `EXCLUSIVE`) and no `supported_locales` (capabilities derives `[locale]`, deliberately refusing to advertise tags the platform cannot format). The backfill writes `tax_display = 'net'` — the engine's actual behaviour today — and `supported_locales = [locale]`, and the migration comment says these were defaulted, not copied.

The backfill is the risky step and the project has a scar here: a previous backfill reported "row counts match" as `0 = 0` because RLS hid the source rows. Run as the non-superuser role, assert a **non-zero** tenant count with exactly one default each, and verify on a cold database — the migration ledger means a developer machine never re-runs the failing path, which is how the `CREATE EXTENSION` race stayed invisible locally.

---

## 10. Back-office shell

Third independently-deployable app: `apps/back-office/`. Imports only from `packages/api-client`, talks to the API only over its public schema. Enforced the same three ways as the storefront: ESLint boundaries, a Compose graph with no edge into API internals, and a Kubernetes NetworkPolicy whose egress permits DNS and the API and nothing else.

Packaging becomes: **API alone · API + storefront · API + back office · all three.**

### Stack: Vite + React SPA, not Next

The storefront is Next 14 for SSR/ISR/SEO; the back office needs none of it — authenticated, dynamic, unindexed.

The argument is evidence, not simplicity: **a second frontend on a different stack proves the API is client-agnostic rather than shaped around Next.** For a project whose central claim is "the API is the product", that is a demonstration rather than an assertion.

### The SPA changes the API's security configuration

Not free, and the cost is security surface rather than toolchain duplication:

- **CORS** must permit the back-office origin, per environment, never wildcard.
- **CSP** — the storefront has a per-request nonce; an SPA's inline-script posture differs and needs its own policy.
- **Token handling** once auth lands: an SPA holding an access token has an XSS blast radius the server-rendered storefront does not. That pushes toward short-lived tokens with refresh in an httpOnly cookie, or a BFF — a real decision the auth slice must make, not an implementation detail.
- **PKCE** flow handling, where Next's ecosystem has more prebuilt support.

### Screens in this slice

- **Shell** — layout, navigation, tenant switcher, channel switcher, error and empty states, `409` conflict handling.
- **Tenant defaults** — edit the inherited baseline.
- **Channels** — list, create, edit, archive, set default. Currency, locale, country, timezone pickers. Inherited values shown as inherited, with an explicit override action. Immutable fields (`key` after draft, `currency` after transacting) disabled with the reason shown rather than failing validation after the fact.
- **Capabilities panel**, read-only, reflecting resolved configuration for the selected channel — proof the switcher does something.

Extract UI strings from the start. Costs nothing now, everything later.

Product, price, order and inventory screens are later slices: each is API work *and* UI work.

### Authentication

See ADR §13. Preferred as a prerequisite slice; a gate is acceptable only with a written expiry in CAVEATS.

---

## 11. Observability

Channel resolution is now on every request. The instrumentation points — designed, not wired, consistent with [ADR-0008](../adr/0008-opentelemetry-designed-not-shipped.md):

- **Read-through fallback rate.** The single signal that says whether event replication is healthy. Low and stable is good; rising means events are being lost and the system is running on reconciliation.
- **Resolution latency** on the hot path.
- **Writes rejected** for unknown or archived channels.
- **URL/header mismatch rejections** — a non-zero rate is either a misconfigured client or an attempt.

---

## 12. Effort

One experienced engineer, solo. Ranges, not commitments. **Excludes authentication.**

| Piece | Weeks |
|---|---|
| Admin API conventions decided and applied to the existing surface | 0.5 |
| URL scoping on cacheable reads + header assertion + guard specs | 0.5 – 1 |
| `channels` module — two tables, migrations, RLS, invariants, contracts, repository, CRUD, version/ETag, events | 2 – 2.5 |
| Resolution in tenant-context; orders/cart carry and snapshot channel; `orders.created` consumer | 1 |
| Read-models with lazy population, read-through, reconciliation | 1 – 1.5 |
| Capabilities move + expand/contract + storefront migration | 0.5 – 1 |
| Back-office shell — app, layout, switchers, tenant defaults, channel CRUD with inheritance and conflict handling, CORS/CSP, api-client wiring, boundary lint, Dockerfile, Compose, CI | 2 – 2.5 |
| Verification: negative controls, cold-database backfill, concurrency tests | folded in, ~0.5 visible |
| Shared idempotency mechanism extracted from checkout | 0.5 |
| Tax-inclusive (gross) computation in the pricing engine; `tax_display` editable; storefront renders per capabilities | 1.5 – 2 |
| **Total** | **≈ 9 – 11.5** |

Authentication, if taken as the prerequisite it should be, is a separate slice on top.

---

## 13. Deliberately not in this slice

Per-channel prices · catalogue scope / product selection · localized content · per-channel themes · payment methods · inventory and `InventorySource` · storefront domain binding · operator-scoped permissions · true multi-currency · data residency (channel-as-market is where GDPR residency attaches; retrofitting region-pinning is brutal, so the seam is named even though the work is not scoped) · bulk import/export · the operations/scheduler portal.
