# Channels slice — build plan

Work breakdown for [ADR-0014](../adr/0014-channel-as-sales-channel.md) and [CHANNEL-MODEL](../design/CHANNEL-MODEL.md).

House rules applied: one item, one commit, one stated verification. Anything needing the word "and" between deliverables is two items. Every verification states **what it prints if the change did nothing** — a check that cannot fail is not a check.

Sizing: BACKLOG.md's rule applies — XS/S/M only, anything larger is split **before it is started**. Phase A is sized now; each later phase gets sized and split when it is next up, not before. Items are numbered by arrival and sequenced by phase, so C-28+ appearing mid-list is deliberate.

---

## Decision gates — all closed 2026-08-28

| Gate | Question | Blocks |
|---|---|---|
| ~~**G-1**~~ | ~~Authentication: prerequisite slice, or gate with a written expiry?~~ **Closed 2026-08-28: prerequisite slice, minimum scope** — the four gateway behaviours ADR-0007 specifies, one operator role, IdP left as configuration. Needs ADR-0015 before C-20. | ~~C-20~~ |
| ~~**G-2**~~ | ~~URL scoping shape?~~ **Closed 2026-08-28:** `/api/{tenant}/{channelKey}/graphql`, segment omitted for the tenant default, `/api` reserved because tenant ids may be `admin`. Reads only — admin and system stay header-only. | ~~C-2~~ |
| ~~**G-3**~~ | ~~Country/timezone for existing tenants?~~ **Closed 2026-08-28: neither.** The tenants are fixtures we generate, so the seed writes real values and the migration keeps only a trivial safety backfill. No derivation, no review flag. | ~~C-11~~ |

G-1 was the only one that could change the slice's size, and it did: an auth slice (~1–1.5 weeks) now precedes Phase E. G-2 settled a grammar. G-3 dissolved on inspection — it was careful data-preservation machinery for rows we generate ourselves.

Nothing now blocks C-1.

---

## Phase A — conventions and scope plumbing

Done first because everything after inherits it, and because URL scoping is cheaper before channels multiply the URLs.

**C-1 — Admin API conventions** *(M)*
Adopt what exists and extend it, rather than invent: cursor pagination in `GET /admin/products`' exact shape (`limit` + `cursor` → `{ items, nextCursor }`) extended to the other admin list endpoints; a filter/sort grammar; the existing Nest error envelope (`{ message, error, statusCode }`) kept, with the `409` body extending it by the current `version`; `PATCH` merge semantics (explicit `null` = inherit vs omitted = leave alone). Idempotency is convention-only here — the mechanism extraction is C-28. Applied to the existing admin surface and written down in `docs/design/ADMIN-API.md`.
*Verification:* a conventions spec run against the live admin surface. If nothing was migrated, it fails on every non-conforming list endpoint by name (no `nextCursor`, cursor ignored); excluding one endpoint from the migration must turn the spec red on exactly that endpoint.

**C-2 — URL scoping for cacheable reads** *(M)*
`/api/{tenant}/{channelKey}/graphql` and `/api/{tenant}/graphql` alongside the existing `/graphql`, which keeps working. No sentinel: an omitted segment means the tenant default. **Non-goal, stated so nobody "completes" the pattern later:** `/admin/*` and `/system/*` do not take scope segments — admin manages channels and is tenant-scoped only, and a uniform external grammar, if ever wanted, is a gateway rewrite rather than an api change.
*Verification:* two requests to the scoped URL for different tenants return different bodies through a caching proxy in front — without scoping the second returns the first's body. Plus a tenant literally named `admin` resolves through `/api/admin/graphql` rather than hitting the admin surface; on a bare `/{tenant}/…` grammar that request 404s or, worse, routes.

**C-3 — Header is the trust input; URL is asserted** *(S)*
Resolve tenant from `x-tenant-id` only; assert the URL segment matches; reject mismatch with `400`.
*Verification:* header tenant A, URL tenant B. Anything but `400` means the assertion is not wired. Also assert the reverse ordering (URL A, header B) rejects, so the check does not pass by comparing a value to itself.

**C-4 — `Vary` extended and guard spec updated** *(S)*
`Vary: x-tenant-id, x-channel-id`; `api-graphql.spec.ts` extended to fail if either header stops being sent or the method reverts to POST.
*Verification:* remove the channel header from the client and confirm the spec fails; remove `Vary` from the response and confirm the proxy test fails.

**C-28 — Shared idempotency mechanism** *(M)*
Extract checkout's `idempotency-key` handling — currently private to `checkout.service.ts`, with its own table in the orders schema — into a shared mechanism admin creates can use. Checkout's behaviour stays byte-identical.
*Verification:* checkout's existing replay behaviour still holds (201 then 200, same order id); an admin create with a reused key returns the original resource. Without the extraction, the second create makes a duplicate and the ids differ.

---

## Phase B — the channels module

**C-5 — Schema and migrations**
`channels.tenant_defaults` and `channels.channels`, RLS on `tenant_id`, `unique (tenant_id, key)`, partial `unique (tenant_id) where is_default`.
*Verification:* run on a **cold** database as the **non-superuser** role. Assert two channels in one tenant are both visible (negative control against accidentally adding a channel RLS policy), and that a second default insert fails.

**C-6 — Contracts**
`Channel` (stored, nullable = inherit), `ChannelConfig` (resolved), `ChannelService`, event types.
*Verification:* boundary lint — a deliberate import of `channels/src` from another module fails the build.

**C-7 — Repository and resolution of inherited config**
Coalesce of channel over tenant defaults.
*Verification:* a channel with all nulls resolves to tenant defaults; overriding one field changes only that field. With coalesce inverted, the override test still passes and the inherit test fails — so both directions are asserted.

**C-8 — Invariants**
Default must be active and cannot be archived; at least one active channel per tenant; `key` immutable once past `draft`; promotion of a new default in one transaction.
*Verification:* each invariant has a test that attempts the violation and asserts rejection. Promotion additionally runs **two concurrent promotions** and asserts one wins cleanly rather than an intermittent constraint violation.

**C-9 — Optimistic concurrency**
`version` on write, `409` on mismatch, `ETag`/`If-Match` on REST, required input on GraphQL mutations.
*Verification:* two writes with the same expected version; the second returns `409`. Without version checking, both succeed and the first change is lost silently.

**C-10 — CRUD endpoints**
REST admin + GraphQL, following C-1 conventions.
*Verification:* the C-1 conventions spec passes against the new endpoints.

**C-11 — Safety backfill** *(S)*
For any tenant in `pricing.tenant_config` without a channel: `tenant_defaults` from its stored currency, locale and tax rate, plus one inheriting default channel. Stated defaults for the fields with no source (`tax_display = 'net'`, `supported_locales = [locale]`, `country = 'US'`, `timezone = 'UTC'`), commented as defaulted rather than copied. This exists so a database that skipped a re-seed still boots — it preserves nothing of value.
*Verification:* run on a **cold** database as the **non-superuser** with rows visible. Assert a **non-zero** tenant count and exactly one default each. A previous backfill in this project reported `0 = 0` as success because RLS hid the source rows — assert non-zero explicitly, not equality.

**C-11a — Seed writes channel fixtures** *(S)*
`t-fashion` gets two channels — `uk` (GBP/`en-GB`/GB/`Europe/London`) and `de` (EUR/`de-DE`/DE/`Europe/Berlin`); `t-electronics` and `t-books` get one US channel each. Real values, no derivation.
*Verification:* after a re-seed, `t-fashion` resolves two channels whose capabilities differ in currency **and** locale. With one channel per tenant — today's fixtures — every downstream channel check passes even if resolution is hardcoded to the default, so this item is what makes C-12 and C-19 falsifiable.

---

## Phase C — resolution and propagation

**C-12 — Channel on the request context** *(depends on C-11a for a falsifiable check)*
Resolution in tenant-context middleware, `AsyncLocalStorage`, `404` on unknown/archived/cross-tenant, default fallback with the expiry recorded in CAVEATS.
*Verification:* **two channels with different currencies** return different responses. One channel passes even if resolution is hardcoded to the default. Separately: an unknown channel returns `404`, not the default.

**C-13 — Events published**
`channels.created`, `channels.updated`, `channels.archived`, `channels.tenant-defaults.updated` — module-prefixed like every existing event. Network-strict.
*Verification:* a consumer asserts payload completeness — no field requires a follow-up lookup. Handler run twice produces the same state (idempotence).

**C-14 — Read-model in consuming modules**
Lazy population, read-through on miss.
*Verification:* stop publishing `channels.created`; a write referencing a new channel must still succeed via read-through. If it fails, validation is querying rather than replicating.

**C-15 — Reconciliation and TTL**
Periodic full reload; bounded staleness. The reload binds `app.system_worker` (the outbox precedent) — with no bound tenant, RLS would feed it zero rows and it would report success reading nothing.
*Verification:* drop a `channels.archived` event and assert the consumer rejects writes to it within the staleness budget — without reconciliation the write succeeds forever and no existing test notices. The reload additionally asserts a **non-zero** row count, so an RLS-blinded reconciler fails rather than passing vacuously.

**C-16 — Orders and cart carry channel**
`channel_id` on both; orders snapshot id, key, name, currency and exponent at checkout; carts are channel-bound.
*Verification:* rename a channel after an order exists; the order still renders its original key and name. Without the snapshot it renders the new one.

**C-17 — `orders.created` sets `has_transacted`; currency frozen**
*Verification:* place an order, then attempt a currency change; assert rejection. Before the consumer is wired, the change succeeds.

---

## Phase D — API surface

**C-18 — Capabilities moves to `channels` and becomes channel-aware**
Channel-scoped fields added; tenant-level fields kept as `@deprecated` aliases resolving the default channel.
*Verification:* deprecated and new fields return the same value for the default channel; a **second tenant with a different currency** makes a constant-wired alias diverge. Codegen drift check fails if the committed client copy is stale.

**C-19 — Storefront migrated to channel-scoped reads**
Scoped URL, both headers, channel-scoped capability fields.
*Verification:* the existing contract-conformance job, plus a cache test: two channels, one tenant, same page, in sequence — the second must not return the first's currency.

---

## Phase E — back office *(preceded by the auth slice, ADR-0015)*

**C-20 — App skeleton**
`apps/back-office/`, Vite + React, api-client-only imports, boundary lint, Dockerfile, Compose service, CI job, NetworkPolicy.
*Verification:* a deliberate import from `packages/modules/*` fails the build; the Compose graph has no edge into API internals.

**C-21 — CORS and CSP for the new origin**
Per-environment allowlist, never wildcard; SPA CSP policy.
*Verification:* a request from a disallowed origin is rejected. With a wildcard, it succeeds — so assert the rejection, not the acceptance.

**C-22 — Shell**
Layout, navigation, tenant switcher, channel switcher, error and empty states, `409` conflict handling, externalised strings.
*Verification:* switching channel changes the read-only capabilities panel. If the switcher is cosmetic, the panel does not change.

**C-23 — Tenant defaults screen**

**C-24 — Channels screen**
List, create, edit, archive, set default. Inherited values shown as inherited with an explicit override action. Immutable fields disabled with the reason shown, not failed after submission.
*Verification:* a channel past `draft` shows `key` disabled; a transacted channel shows currency disabled. If the guard is server-only, the field renders editable and fails on save.

---

## Phase F — closing out

**C-25 — Observability points**
Read-through fallback rate, resolution latency, rejected writes, URL/header mismatch count. Designed and emitted; exporter still out of scope per ADR-0008.
*Verification:* force a read-through and assert the counter moves. A counter that never moves is indistinguishable from a healthy system.

**C-26 — CAVEATS entries**
Missing-channel fallback expiry; auth posture per G-1; tax simplification; locale formatting ≠ localized content; multi-currency not delivered; cache cardinality.

**C-27 — Docs reconciled**
ARCHITECTURE, RUNBOOK, README updated. Every documented command executed, not re-read.
*Verification:* run the README flow cold. Two commands in this project's own instruction file had previously never worked at all.

---

## Phase G — gross pricing

The work A1 surfaced: `tax_display` must be real before it is editable. The engine computes net-only today and capabilities hardcodes `EXCLUSIVE`; making the field a channel control without the engine work would let an operator select gross and silently serve net.

**C-29 — Tax-inclusive computation in the pricing engine**
`totals-calculator` and `money-ops` learn gross mode: derive base and tax out of a tax-inclusive price under ADR-0005's rounding, golden tests for both modes side by side.
*Verification:* golden tests pin the gross decompositions; net mode's outputs are asserted byte-identical to today's. If the engine ignored the mode, gross cases equal net cases and fail.

**C-30 — `tax_display` editable per channel; the hardcode removed**
Capabilities reports the stored value instead of the `EXCLUSIVE` constant; channel `PATCH` accepts it; order snapshots record the mode they were charged under.
*Verification:* switch a channel to gross; capabilities flips and a priced cart's totals change shape. If capabilities still reads the constant, the flip changes nothing.

**C-31 — Storefront renders gross/net from capabilities**
*Verification:* the same product on two channels — one gross, one net — renders different price presentation. One channel would pass even with hardcoded rendering; two is the control.

Strictly C-29 → C-30 → C-31: the control becomes editable only after the engine honours it.

---

## Sequencing notes

Phase A before B: URL scoping is cheaper before channels multiply the URLs, and the admin conventions shape every endpoint in Phase B.

C-15 before C-19: the storefront should not depend on a read-model whose staleness is unclosed.

Phase E is preceded by the auth slice, which is its own ADR (0015) and its own sequence — not items here. It lands before C-20 because the console must not exist without a login.

Phase G touches pricing, not channels plumbing, so it can run any time after Phase B — except C-30, which needs C-10 (channel `PATCH` exists).

**Total ≈ 9–11.5 weeks excluding authentication.**
