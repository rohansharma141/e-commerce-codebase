# Channels slice — build plan

Work breakdown for [ADR-0014](../adr/0014-channel-as-sales-channel.md) and [CHANNEL-MODEL](../design/CHANNEL-MODEL.md). Start at [CHANNELS-OVERVIEW](../design/CHANNELS-OVERVIEW.md) for what this delivers and why.

House rules applied: one item, one commit, one stated verification. Anything needing the word "and" between deliverables is two items. Every verification states **what it prints if the change did nothing** — a check that cannot fail is not a check.

> ### ✅ Verified 2026-08-28 — and it found three real bugs
>
> C-5, C-7, C-10, C-11a and C-2b were written without a database, then verified against a **cold** one (`docker compose down -v`). **134 channels tests, 45 admin-conventions, 19 scoped-graphql — all green.** Three defects were found, every one of them silent:
>
> 1. **The api would not boot at all.** `apps/api/Dockerfile` copies each module's migrations explicitly and channels had no line, so the container died with *"channels migrations directory not found"*. Invisible locally — `nx serve` and every test read migrations straight from the source tree, so only a built image fails. The Dockerfile now carries a warning for the next module.
> 2. **Every transaction silently saw zero rows.** Drizzle's `db.transaction()` resolves to the *parent* client's `begin()`, taking a fresh pool connection with no `app.tenant_id` — so RLS hid everything inside it. Proven rather than guessed, with a probe printing `OUTSIDE: probe-tenant  INSIDE: null`. No error is raised: `UPDATE … WHERE <policy hides the row>` is legal SQL affecting zero rows. This had already been discovered once in `checkout.service.ts` and solved locally there, so it is now extracted as **`withTenantTransaction`** in shared, with the failure mode written down. This one bug caused **17 of the 19** initial failures.
> 3. **`PATCH` updated nothing.** The dynamic `set` object used SQL column names (`tax_rate_bps`) where Drizzle wants schema properties (`taxRateBps`). Unrecognised keys are dropped, so the update succeeded, bumped `version`, returned a row, and changed nothing. The `put` helper's key type is now bound to the row shape — a column name is a **compile error**, confirmed by reintroducing one.
>
> All three share a shape worth naming: **each one succeeded while doing nothing.** None would have been caught by a check asserting "no error was thrown"; each was caught by asserting the new value was actually there.

Sizing: BACKLOG.md's rule applies — XS/S/M only, anything larger is split **before it is started**. Phase A is sized now; each later phase gets sized and split when it is next up, not before. Items are numbered by arrival and sequenced by phase, so C-28+ appearing mid-list is deliberate.

---

## Decision gates — all closed 2026-08-28

| Gate | Question | Blocks |
|---|---|---|
| ~~**G-1**~~ | ~~Authentication: prerequisite slice, or gate with a written expiry?~~ **Closed 2026-08-28: prerequisite slice, minimum scope** — the four gateway behaviours ADR-0007 specifies, one operator role, IdP left as configuration. **[ADR-0015](adr/0015-operator-authentication-at-the-api-edge.md) written 2026-08-28** — designed, not built. | ~~C-20~~ |
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

**C-5 — Schema and migrations** ✅ *verified on a cold database*
`channels.tenant_defaults` and `channels.channels`, RLS on `tenant_id` with the `app.system_worker` clause, `unique (tenant_id, key)`, partial `unique (tenant_id) where is_default`, a key-format CHECK mirroring the contracts regex, and status/tax CHECK constraints. Module wired into the api so migrations run at boot.
*Verified 2026-08-28.* Migration applied cold (`applied=2 skipped=0`); `\d` confirms the partial unique index keeps its `WHERE is_default` predicate, every CHECK constraint exists, and RLS reports *forced row security enabled* with the system-worker clause. Run on a **cold** database as the **non-superuser** role. Two channels in one tenant are both visible (the negative control against someone later adding a channel RLS policy), a second default insert fails, the same key is allowed under two tenants, and a URL-breaking key is rejected. Every isolation assertion is paired with a **non-zero** assertion on the same connection, because a policy that hides everything passes an isolation test that only checks what is absent.

**C-6 — Contracts** ✅
`Channel` (stored, nullable = inherit), `ChannelConfig` (resolved), `ResolvedChannel` (config + which fields were inherited), `IChannelsQuery` / `ChannelsAdmin`, event types, and two pure functions: `resolveChannelConfig` and `minorUnitsFor`.

*Shipped 2026-08-28.* Both packages created, because the stated boundary check needs a real target: without `channels/src` existing, an import of it fails as "module not found" and the check passes for the wrong reason. `src/` is an empty scaffold plus the specs, matching `money-ops.spec.ts` — pure logic in `contracts/`, its tests in `src/`.

*Verification:* the violation was added, not imagined — `pricing/src` importing `@platform/modules/channels/src` fails lint with *"A project tagged with type:src can only depend on libs tagged with scope:shared, type:contracts"*, then reverted. Plus 26 unit tests on the pure logic, and 27 projects green on lint + build + test.

*Scope moved, deliberately:* the coalesce that C-7 was to deliver is here instead, as a pure dependency-free function. Inheritance is resolved in three places (repository C-7, consuming read-models C-14, back office C-24); three implementations is how a tenant ends up with a currency that depends on which endpoint you ask. It also makes C-6 verifiable behaviourally rather than "it compiles" — and needs no database, which is why it could be built with Docker down. **C-7 is reduced to the repository.**

Two bugs the tests were written to catch, both of which a thinner suite would have missed:
- `channel.taxRateBps || defaults.taxRateBps` silently turns a tax-free market (0) into 8.75%. Only an explicit null check is correct.
- Minor units must derive from the **resolved** currency, not the tenant default, or a JPY channel under a USD tenant renders every price a hundredfold too small.

`minorUnitsFor` derives from `Intl` rather than a table, which gets the three-decimal Gulf currencies (KWD, BHD) right — the ones hand-kept tables miss. Its known limit is pinned rather than left to be found: a well-formed but unassigned code (`XYZ`) silently yields 2, because Intl reports the CLDR default instead of failing. Catching a typo'd currency is write-time validation's job (**C-8**), not this function's. `capabilities.module.ts` still holds a five-entry table with a fallback of 2; it becomes redundant at C-18.

**C-7 — Repository** ✅ *verified* *(reduced: resolution moved to C-6)*
Persistence for both tables, resolving through C-6's pure `resolveChannelConfig` rather than reimplementing the coalesce. Includes optimistic concurrency (`version`, `VersionConflictError` carrying the current version so a client can re-read), `PATCH` merge semantics at the SQL level (an omitted field is not named in the UPDATE; an explicit null is), and `promoteDefault` as a single transaction with the unset strictly before the set.
*Verified.* Inherit and override asserted in both directions; unknown, archived and cross-tenant keys all resolve to null and never to the default; a stale version is rejected; two concurrent promotions leave exactly one default rather than an intermittent constraint violation.

**Still outstanding for C-7, and not attempted:** the invariant predicates from C-8a are *not yet called* by this repository — that remains C-8b. The repository will currently accept a rename past `draft` and a currency change after transacting. That is the documented split, not an oversight, but it means the repository is not safe to expose through C-10's endpoints until C-8b lands.

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

**C-8b — Invariants enforced, in a service above the repository** ✅ *(the guards are verified; the SQL beneath them is not)*
C-8a's predicates are composed in `ChannelsService`, not in the repository. The repository owns SQL and nothing else; the service is the only place rules and persistence meet, which is what stops a rule applying on one path and not another — the failure where a channel created through the admin API is validated and one created by the seed is not. It also owns the failure-to-HTTP mapping, because that is a property of the operation rather than of storage: violations → `400` listing **all** of them, version conflict → `409` carrying `currentVersion`, missing → `404`.

*Verification — RUN, and made to fail.* The service depends on a `ChannelStore` port rather than on `ChannelsRepository` directly, so the guards are testable against an in-memory fake. That seam matters more than usual here: the repository's SQL has never touched a database, and without it these guards would inherit that uncertainty instead of being independently known-good. Disabling the guards failed exactly **11 tests** — every `rejects` case — while every `allows` case and the 409 mapping stayed green.

Each rejection asserts `store.writes` is empty, not merely that an error was thrown. A service that threw *after* persisting would pass a test that only checked the throw.

**Still outstanding, and needs a database:** the DDL guarantees that must not fail open — `unique (tenant_id, key)` and the partial `unique (tenant_id) where is_default` — plus the two-concurrent-promotions race. Those are written in `channels.integration.spec.ts` and have never run. An application-only guarantee of "exactly one default" is not a guarantee, so the index has to be asserted directly rather than inferred from the service refusing.

**C-9 — Optimistic concurrency**
`version` on write, `409` on mismatch, `ETag`/`If-Match` on REST, required input on GraphQL mutations.
*Verification:* two writes with the same expected version; the second returns `409`. Without version checking, both succeed and the first change is lost silently.

**C-10 — Admin CRUD endpoints** ✅ *verified end to end*
`GET/POST /admin/channels`, `GET/PATCH /admin/channels/:id`, `POST /admin/channels/:id/archive`, `POST /admin/channels/:id/promote-default`, `GET/PATCH /admin/tenant-defaults`. Cursor-paginated on `key`, the standard error envelope, `PATCH` merging with explicit-null meaning inherit, `If-Match` carrying the version and `409` returning `currentVersion`. `@ApiProperty` classes so `/docs-json` shows real schemas.

*Verification:* `/admin/channels` is now a row in `admin-conventions.integration.spec.ts`, which is C-10's stated check — a new endpoint satisfies the conventions rather than the conventions being restated for it. **Run 2026-08-28: 45/45 pass**, the 7 new `/admin/channels` rows included. `/docs-json` went 27 → 35 schemas, all with real properties, and the generated REST client was regenerated so R-4 stays green.

Two pieces of controller logic are not delegation, and both *are* verified by tests that run, because both are pure and both are the kind of thing that silently half-works:
- **`If-Match` is required.** Mutating it to default silently to `0` failed the test. Treating an absent precondition as "no precondition" is how optimistic concurrency quietly stops applying to the one client that forgot it — the client that overwrites someone else's edit. Note TypeScript itself refuses the naive removal: the throw is what narrows `string | undefined`.
- **`inherited` is converted from a `Set` to an array at the boundary.** `JSON.stringify(new Set())` is `{}`, so without this the back office receives `"inherited": {}` and cannot tell an inherited field from an overridden one — they look identical in `config`. Mutating it away failed three tests, one of which asserts on the serialised form rather than the object, since the bug only appears after `stringify`.

*Deliberately not built:* the GraphQL half. Nothing consumes a channel query until the storefront does, and an unused public surface is a maintenance cost with no consumer. It lands with **C-19**, where it has one.

**C-11a — Seed writes channel fixtures** ✅ *verified*
`t-fashion` gets **two** channels — `uk` (inherits everything) and `de` (EUR/`de-DE`/DE/`Europe/Berlin`, overriding everything). `t-electronics` and `t-books` get one US channel each. Tenant defaults carry real values per tenant.

The two-channel tenant is the point: ADR-0014's negative control is *"two channels with different currencies; assert responses differ"*, and one channel per tenant passes even if resolution is hardcoded to the default. It is also what lets `/admin/channels` be a row in the conventions spec at all, since that needs two rows to paginate. `uk` inheriting and `de` overriding means one fixture exercises both directions of the coalesce.

`taxDisplay` is seeded `net` for every tenant on purpose: C-29 taught the engine `gross`, but until C-30 removes the `EXCLUSIVE` hardcode from capabilities, a `gross` fixture would advertise a presentation the API does not report. A fixture that lies is worse than a fixture that is dull.

**C-11 — Safety backfill** *(S)*
For any tenant in `pricing.tenant_config` without a channel: `tenant_defaults` from its stored currency, locale and tax rate, plus one inheriting default channel. Stated defaults for the fields with no source (`tax_display = 'net'`, `supported_locales = [locale]`, `country = 'US'`, `timezone = 'UTC'`), commented as defaulted rather than copied. This exists so a database that skipped a re-seed still boots — it preserves nothing of value.
*Verification:* run on a **cold** database as the **non-superuser** with rows visible. Assert a **non-zero** tenant count and exactly one default each. A previous backfill in this project reported `0 = 0` as success because RLS hid the source rows — assert non-zero explicitly, not equality.



---

## Phase C — resolution and propagation

**C-12 — Channel on the request context** ✅ *verified*
`ChannelScopeMiddleware` resolves `x-channel-id` and binds the channel onto the existing tenant context — one `AsyncLocalStorage`, a field on the context, not a parallel mechanism.

*Where it lives, and why not in `tenant.middleware.ts`:* a boundary constraint. `scope:shared` may only depend on `scope:shared`, so the shared tenant middleware cannot reach the channels contracts — and it could not do the work anyway, because resolution needs the tenant-bound connection that `TenantBindingMiddleware` establishes afterwards. So the context carries `channelId`/`channelKey` as plain strings (the only shape shared may name) and the channels module fills them in third. `bindChannel` is the single supported mutation point.

*The header carries the **key**, not the UUID.* ADR-0014 §4 defines `id` as "what other modules store" and `key` as "what humans and integrations use", and a request header is an integration surface. `x-tenant-id` already sets the precedent — it carries `t-fashion`, not a surrogate. The header name is the ADR's.

*Verification — RUN, and made to fail.* The branch that matters is **absent versus unknown**, and conflating them is the failure this design is arranged against, so it is tested directly rather than inferred from an HTTP round trip. Mutating the middleware to fall back silently instead of throwing failed 2 tests, including one asserting `next()` was *not* called — a middleware that threw and continued would serve the request unscoped, which is the fallback it just refused. 115 channels tests pass.

`findByKey` excluding archived and cross-tenant rows is now confirmed against real RLS, not assumed by a fake.

**C-2b — The channel segment of the URL grammar** ✅ *verified*
`/api/{tenant}/{channelKey}/graphql` alongside `/api/{tenant}/graphql`. The two forms are distinguished by segment count alone, which is why a channel keyed `graphql` is unambiguous rather than a collision — `/api/t/graphql` is the default, `/api/t/graphql/graphql` names that channel. No `default` sentinel is reserved.

The segment is asserted against `x-channel-id` exactly as the tenant segment is against `x-tenant-id`, mismatch is `400` both ways round, and **a channel URL with no channel header is also `400`** — the caller named a channel, and serving the default instead would answer a question nobody asked. Resolution and the `404` stay in C-12's middleware, which runs later and has the database connection this one does not.
*Verified: 19/19 pass*, including an unknown channel returning `404` rather than falling back, and mismatch rejected in both directions.

**C-13 — Events published** ✅
`channels.created`, `channels.updated`, `channels.archived`, `channels.default-changed`, `channels.tenant-defaults.updated` — module-prefixed like every existing event. Published **after** the write commits, never inside it: a consumer that receives `created` and immediately reads through (C-14) must find the row, and the in-process bus makes that ordering easy to get wrong precisely because it feels synchronous.

*Verified 2026-08-28, and made to fail twice.* Events go through a **real `EventBus`**, not a stubbed `publish()`, so payloads pass through its `structuredClone` — which is what actually enforces "network-strict". A `Set`, a class instance or a function fails in the test rather than at a network boundary that does not exist yet.

- **Payload completeness.** `created` carries the **resolved** config, not the stored row. Mutating it to send the row's inherit-nulls failed the test — a consumer receiving `currencyCode: null` would have to ask this module what the tenant default is, which is the synchronous cross-module read ADR-0014 §3 rules out.
- **Archival is its own event.** Mutating it to emit a plain `updated` failed 2 tests. A consumer subscribed only to `updated` would keep resolving a closed market; a separate name makes forgetting it a visible gap rather than a silent one.
- **Idempotence.** A handler run twice on the same event reaches the same state, modelled as the upsert-by-`channelId` read-model C-14 will build. An appending handler ends with two rows.
- **`changed` diffs the stored row, not the patch keys.** A `PATCH` may name a field and set it to the value it already had; reporting that as a change would invalidate caches for a write that moved nothing.
- **One tenant-defaults event, not one per channel.** Fanning out per channel is a thundering herd on a single operator click — a tenant with fifty markets would emit fifty events for one edit.

*A mistake worth recording:* the events contract already existed from C-6 and was overwritten on the assumption it was a stub, dropping `channels.default-changed` and `tenantId` from the archived payload. Caught by reading the diff before committing, and restored — the original's reasoning was better than the replacement's.

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

**C-29 — Tax-inclusive computation in the pricing engine** ✅
`money-ops` gains `taxIncludedIn`; `computeTotals` takes an optional `taxMode`, defaulting to `net`. Built out of sequence (before Phase B) because it is pure arithmetic and needs no database.

*Shipped 2026-08-28.* The maths: `tax = gross × bps / (10000 + bps)`, not `mulBps`. Reaching for `mulBps` overstates tax by the rate itself — 20% *of* £120 is £24, but the VAT *inside* £120 is £20 — and the receipt still adds up, so nothing downstream notices. Net is derived as `gross − tax` rather than rounded separately, making `net + tax === gross` true by construction; rounding both halves independently loses or invents a cent on roughly half of all amounts, and that cent reaches a customer.

The banker's-rounding core was extracted so `mulBps` and `taxIncludedIn` share one implementation. Two copies of a rounding policy is how a platform computes tax one way when adding it and another when extracting it, visible only at the aggregate. ADR-0005's sentinel tests were run immediately after the refactor and still pass, so `mulBps` is unchanged.

*Verification — three ways, each made to fail:*
- **Golden cases assert both modes side by side on identical input.** A gross-only suite passes against an engine that silently computes net.
- **Making the engine ignore `taxMode`** failed exactly the 5 golden cases and both gross invariants; net tests stayed green.
- **Swapping `taxIncludedIn` for `mulBps`** in the gross branch failed 6 — the specific bug the function exists to prevent.
- Two of my own golden values were wrong (computed half-up, not half-even) and the tests caught them. They are now kept as labelled `.5`-tie sentinels, the only cases that can tell the two rounding policies apart.

*Design decision:* `taxMode` is an **input only** — deliberately not a field on `ComputedTotals`. `capabilities.taxDisplay` is already where "how to read this tenant's prices" lives and the storefront already fetches it; repeating it on every cart and order response would be a second source for one fact, and the two would eventually disagree. This also kept C-29 entirely engine-internal: no HTTP DTO changed, so no OpenAPI regeneration is owed and R-4 stays green. `CartTotals implements ComputedTotals` is what surfaced the question — the contract coupling working as designed.

**C-30 — `tax_display` editable per channel; the hardcode removed**
Capabilities reports the stored value instead of the `EXCLUSIVE` constant; channel `PATCH` accepts it; order snapshots record the mode they were charged under.
*Verification:* switch a channel to gross; capabilities flips and a priced cart's totals change shape. If capabilities still reads the constant, the flip changes nothing.

**C-31 — Storefront renders gross/net from capabilities**
*Verification:* the same product on two channels — one gross, one net — renders different price presentation. One channel would pass even with hardcoded rendering; two is the control.

Strictly C-29 → C-30 → C-31: the control becomes editable only after the engine honours it. C-29 is done; C-30 needs C-10 (channel `PATCH` exists) and a database.

---

## Sequencing notes

Phase A before B: URL scoping is cheaper before channels multiply the URLs, and the admin conventions shape every endpoint in Phase B.

C-15 before C-19: the storefront should not depend on a read-model whose staleness is unclosed.

Phase E is preceded by the auth slice, which is its own ADR (0015) and its own sequence — not items here. It lands before C-20 because the console must not exist without a login.

Phase G touches pricing, not channels plumbing, so it can run any time after Phase B — except C-30, which needs C-10 (channel `PATCH` exists).

**Total ≈ 9–11.5 weeks excluding authentication.**
