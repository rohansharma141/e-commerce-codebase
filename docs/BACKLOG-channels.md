# Channels slice — build plan

Work breakdown for [ADR-0014](../adr/0014-channel-as-sales-channel.md) and [CHANNEL-MODEL](../design/CHANNEL-MODEL.md). Start at [CHANNELS-OVERVIEW](../design/CHANNELS-OVERVIEW.md) for what this delivers and why.

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

**C-1 — Admin API conventions** ✅ *(M)*
Adopt what exists and extend it, rather than invent: cursor pagination in `GET /admin/products`' exact shape (`limit` + `cursor` → `{ items, nextCursor }`) extended to the other admin list endpoints; a filter/sort grammar; the existing Nest error envelope (`{ message, error, statusCode }`) kept, with the `409` body extending it by the current `version`; `PATCH` merge semantics (explicit `null` = inherit vs omitted = leave alone). Idempotency is convention-only here — the mechanism extraction is C-28. Applied to the existing admin surface and written down in `docs/design/ADMIN-API.md`.
*Verification:* a conventions spec run against the live admin surface. If nothing was migrated, it fails on every non-conforming list endpoint by name (no `nextCursor`, cursor ignored); excluding one endpoint from the migration must turn the spec red on exactly that endpoint.

*Shipped 2026-08-28.* Verified in both directions: run against the unmigrated surface the spec reported **16 failures across the four non-conforming endpoints while `/admin/products` passed everything**; after the migration, deliberately making one endpoint ignore its cursor turned red **only that endpoint**, 4 of its 7 tests, by name. 38 tests green with the break reverted.

Two things the plan had not anticipated, both found by running rather than reading:

- **Three of the four had no `ORDER BY` at all**, so cursoring had to be preceded by giving them a total order. `GET /admin/prices?limit=50` was therefore already subtly wrong — "the first 50" was not a stable set between two calls. `pricing.prices` also has no `id` column, so it cursors on `product_id`; its `updated_at` holds 99,004 rows across 103 distinct values and would have skipped ~960 rows per page.
- **`created_at` alone is not a total order**, so orders and promotions use a `(created_at, id)` row comparison. Binding a JS `Date` inside a raw `sql` fragment throws `ERR_INVALID_ARG_TYPE` in postgres-js — a 500 on page two while page one looked perfect. ISO strings with explicit `::timestamptz` / `::uuid` casts.

Scope grew slightly and deliberately: `/admin/products` was folded in too (shared codec, `@ApiOkResponse`, default page size 20 → 50), because documenting a convention the reference endpoint did not follow would have been the exact doc-versus-code gap this phase exists to close. `attribute-definitions.listByTenant` was left unpaginated on purpose — `attribute-validator.ts` needs the full set, and paginating it would have silently stopped validating past page one.

Delivered: [`docs/design/ADMIN-API.md`](design/ADMIN-API.md), the shared cursor codec in `packages/shared/database/src/cursor.ts` (19 unit tests), five migrated list endpoints, `@ApiProperty` classes for catalog and pricing (17 → 27 OpenAPI schemas), regenerated REST client, and a CI step running the suite against the live seeded api.

**C-2 + C-3 — URL scoping for cacheable reads, and the trust assertion** ✅ *(M)*
`/api/{tenant}/graphql` alongside the existing `/graphql`, which keeps working. Tenant resolves from `x-tenant-id` only; the URL segment is asserted to match; a mismatch is `400`. **Non-goal, stated so nobody "completes" the pattern later:** `/admin/*` and `/system/*` do not take scope segments — admin manages channels and is tenant-scoped only, and a uniform external grammar, if ever wanted, is a gateway rewrite rather than an api change.

*Shipped 2026-08-28 as one commit, and the merge was not a convenience.* Routing the path in C-2 and asserting it in C-3 would have left a window in which `/api/{victim}/graphql` served whatever the caller's header asked for. Same reasoning that reordered 8c-3: no intermediate state may violate a non-negotiable.

*Split, recorded:* the `{channelKey}` segment is **not** routed yet. Channels do not exist until Phase B, so a channel path would resolve against nothing and accept any key — a route wired to nothing, which A1 established we do not build. It lands as **C-2b in Phase C**, beside C-12, where it can be asserted the way the tenant segment now is.

*Verification, run red first:* 8 of 14 failed against the unmodified api. Two matter most:

- **The bug is real, not hypothetical.** `THE BUG: on the unscoped path, one tenant is served the other from cache` **passed before the fix** — an in-process proxy keying on URL alone (a CDN ignoring `Vary` over a custom header) served `t-books` the `t-fashion` body through the shipped `/graphql`. `THE FIX` then failed, the scoped path not existing. Both green now, and the bug assertion is deliberately kept: if it ever stops holding, the demonstration has lost its contrast.
- A tenant literally named `admin` resolves through `/api/admin/graphql` rather than reaching the admin surface — which is why `/api` is a reserved prefix.

GET is covered explicitly, including that the scoped path still reaches `graphql-cache.plugin.ts` and emits the same `cache-control` and `vary` as the unscoped one. A scoped path working only for POST would carry scope on exactly the requests no cache keys, and would have silently undone H-3b.

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

**C-6 — Contracts** ✅
`Channel` (stored, nullable = inherit), `ChannelConfig` (resolved), `ResolvedChannel` (config + which fields were inherited), `IChannelsQuery` / `ChannelsAdmin`, event types, and two pure functions: `resolveChannelConfig` and `minorUnitsFor`.

*Shipped 2026-08-28.* Both packages created, because the stated boundary check needs a real target: without `channels/src` existing, an import of it fails as "module not found" and the check passes for the wrong reason. `src/` is an empty scaffold plus the specs, matching `money-ops.spec.ts` — pure logic in `contracts/`, its tests in `src/`.

*Verification:* the violation was added, not imagined — `pricing/src` importing `@platform/modules/channels/src` fails lint with *"A project tagged with type:src can only depend on libs tagged with scope:shared, type:contracts"*, then reverted. Plus 26 unit tests on the pure logic, and 27 projects green on lint + build + test.

*Scope moved, deliberately:* the coalesce that C-7 was to deliver is here instead, as a pure dependency-free function. Inheritance is resolved in three places (repository C-7, consuming read-models C-14, back office C-24); three implementations is how a tenant ends up with a currency that depends on which endpoint you ask. It also makes C-6 verifiable behaviourally rather than "it compiles" — and needs no database, which is why it could be built with Docker down. **C-7 is reduced to the repository.**

Two bugs the tests were written to catch, both of which a thinner suite would have missed:
- `channel.taxRateBps || defaults.taxRateBps` silently turns a tax-free market (0) into 8.75%. Only an explicit null check is correct.
- Minor units must derive from the **resolved** currency, not the tenant default, or a JPY channel under a USD tenant renders every price a hundredfold too small.

`minorUnitsFor` derives from `Intl` rather than a table, which gets the three-decimal Gulf currencies (KWD, BHD) right — the ones hand-kept tables miss. Its known limit is pinned rather than left to be found: a well-formed but unassigned code (`XYZ`) silently yields 2, because Intl reports the CLDR default instead of failing. Catching a typo'd currency is write-time validation's job (**C-8**), not this function's. `capabilities.module.ts` still holds a five-entry table with a fallback of 2; it becomes redundant at C-18.

**C-7 — Repository** *(reduced: resolution moved to C-6)*
Persistence for `channels.channels` and `channels.tenant_defaults`, returning `ResolvedChannel` via C-6's `resolveChannelConfig`.
*Verification:* a channel with all nulls resolves to tenant defaults; overriding one field changes only that field. Both directions asserted — with the coalesce inverted, the override test still passes and only the inherit test fails.

**C-8a — Invariant rules** ✅ *(pure; no database)*
The rules as pure predicates in `contracts/invariants.ts`: `key` immutable once past `draft`, `currencyCode` frozen once transacted, the default must be active and cannot be archived, a tenant keeps at least one active channel, key format, a supported-currency allowlist, and a status transition table. Violations are **returned, all of them, not thrown one at a time** — the back office edits a whole channel in one form, so first-error-wins turns one round trip into four.

*Shipped 2026-08-28.* Separated from persistence so each rule is tested by attempting the violation rather than inferred from a repository that happens not to allow it.

*Verification — the suite was made to fail before it was trusted.* 74 tests passed on first write, which is exactly when to distrust them, so two mutations were run:
- **Neutering `validateChannelUpdate`** (early return) failed exactly the 9 `rejects` tests and left the other 65 green — the rejection tests are load-bearing, and scoped to the function mutated.
- **Inverting the key-immutability condition** failed *both* `rejects a rename once past draft` **and** `allows a rename while still draft`. That is the point of pairing them: a validator that refuses everything passes a suite of only-rejections.

*Two rules that were derived, not copied from the design, and are flagged as such:*
- **Nothing returns to `draft`.** Not stated anywhere, but without it `key` immutability is circumventable — archive, re-draft, rename, re-activate — and every URL, integration and cache tag pointing at the old key silently resolves elsewhere. A rule that exists only to protect a stated rule.
- **`archived → active` is allowed.** Also unstated. Permitted because a market can reopen and forbidding it makes a mis-archive unrecoverable; safe because the key is already frozen by then. Flagging it because it is a product decision made in code — say so if it should be otherwise.

The supported-currency allowlist is the write-time validation C-6 deferred here: `minorUnitsFor` cannot tell a typo from a real currency, and after the first order `currencyCode` freezes, so the mistake becomes permanent.

**C-8b — Invariants enforced in the repository** *(needs a database)*
Wire C-8a's predicates into the repository, plus the DDL guarantees that must not fail open: `unique (tenant_id, key)` and `unique (tenant_id) where is_default`.
*Verification:* promotion runs **two concurrent promotions** and asserts one wins cleanly rather than an intermittent constraint violation. An application-only guarantee of "exactly one default" is not a guarantee, so the partial unique index is asserted directly by attempting a second default insert.

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

**C-2b — The channel segment of the URL grammar** *(split out of C-2, 2026-08-28)*
`/api/{tenant}/{channelKey}/graphql`. The segment is omitted, not sentinelled, for the tenant default — §4 argues against reserving the literal `default` as a key, and an optional segment removes the reserved word entirely. It carries the `key`, not the id. Asserted against `x-channel-id` exactly as the tenant segment is against `x-tenant-id`; mismatch is `400`, unknown/archived/cross-tenant is `404` and never a silent fallback.
*Depends on C-12* for resolution. Deferred out of Phase A because until channels exist the segment would accept any key and resolve against nothing.
*Verification:* two channels of one tenant with different currencies return different bodies through the URL-keyed proxy already in `scoped-graphql.integration.spec.ts`. One channel would pass even if the segment were ignored entirely, so C-11a's two-channel `t-fashion` is what makes this falsifiable. Plus: header names channel A, URL names B → `400`, asserted both ways round.

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

**C-18 — Capabilities becomes channel-aware**
Stays in the composition root (ADR §7): it also reports `apiVersion` and the deployment feature map, which no domain module should own. What changes is its source — it composes from the `channels` contract instead of reading pricing config directly. Channel-scoped fields added; tenant-level fields kept as `@deprecated` aliases resolving the default channel.
*Verification:* deprecated and new fields agree for the default channel, and **t-fashion's two channels** (GBP and EUR, via C-11a) make a constant-wired alias diverge — a single-channel tenant passes even if the alias ignores the channel entirely. Codegen drift check fails if the committed client copy is stale.

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
