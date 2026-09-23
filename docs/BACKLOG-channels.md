# Channels slice — build plan

Work breakdown for [ADR-0014](adr/0014-channel-as-sales-channel.md) and [CHANNEL-MODEL](design/CHANNEL-MODEL.md). Start at [CHANNELS-OVERVIEW](design/CHANNELS-OVERVIEW.md) for what this delivers and why.

House rules applied: one item, one commit, one stated verification. Anything needing the word "and" between deliverables is two items. Every verification states **what it prints if the change did nothing** — a check that cannot fail is not a check.

## Status as of 2026-09-23

**Read this section first when resuming.** Then [CHANNELS-BUILD-NOTES](design/CHANNELS-BUILD-NOTES.md) for the traps and mistakes that cost time, and the rows below for each item's verification record.

`main` = `433f5b6` (61 commits, CI green, `v0.1.0`). `channels` branched from it. Code changed last in C-19d (2026-09-23); `git log -1 --format='%h %s' -- apps packages` names the latest commit to touch code, so a docs-only commit cannot make this line stale. **CI has never run on this branch** — it triggers only on `main` and on PRs into it, so every "verified" below is local.

### Done — 31 rows, all verified

| Phase | Rows |
|---|---|
| A — conventions and scope | C-1, C-2, C-3, C-2b, C-4 *(api half)*, C-9 *(REST half)* |
| B — the channels module | C-5, C-6, C-7, C-8a, C-8b, C-10, C-11a, C-11 |
| C — resolution and propagation | C-12, C-13, C-14, C-15, C-16a, C-16b, C-17, C-33 |
| D — API surface | C-32a, C-32b, C-18a, C-18b, C-19a, C-19b, C-19d |
| F / G | C-26, C-29 |

Plus [ADR-0015](adr/0015-operator-authentication-at-the-api-edge.md) (operator auth, designed not built). Test counts, measured 2026-09-22 with C-18b in both images. Unit: channels 144 plus 24 database-gated, pricing 69, cart 21, api 27; storefront 99 at C-19d. Database, on a throwaway `platform_test`: channels 168, and checkout integration 13, C-11 backfill 7, C-33 backfill 6 and the C-32b middleware 7, run together (at C-32b; unchanged since). Live: 45 admin-conventions, 6 admin-concurrency, 19 scoped-graphql, storefront 106 at C-19d — its 99 unit tests and the 7-test conformance suite. (Recorded until C-19a as "46 storefront (38 conformance and 8 route)", a mislabel found by counting per suite: 46 was the whole suite, and 7 of it conformance.) C-32b's live script 28 expectations and C-18a's 24, 0 failures each; C-18b's freshness check, before and after. scoped-graphql's one unexplained 30 s timeout, in the first run after C-33, has not recurred in four runs since; it stays recorded as unexplained. The RUNBOOK's order recipe and upgrade-path block were run verbatim, extracted from the file.

### Decided 2026-09-22

**Gate G-4 is closed: option A now, option B later as its own phase.** Seen live on 2026-09-19: an order in `t-fashion`'s EUR channel `de` was charged **GBP**, because nothing on the money path consults the channel.

| Option | What `de` does | Outcome |
|---|---|---|
| **A. Refuse** | refuses to price: a named error instead of GBP numbers | **chosen, now** — C-32 |
| **B. Per-channel price lists** | charges EUR from real EUR prices | **chosen, later** — its own ADR and phase ([Phase H](#phase-h--per-channel-price-lists-g-4-option-b)) |
| **C. Relabel** | same integer under a € symbol | rejected — ADR-0014 §9 names this as the money bug |

**A is wider than first written.** The first sizing (C-32 ≈ 2–3 h) counted carts and checkout only. Refusing has to cover reads in the channel too: otherwise C-18 makes `de` report EUR while search still returns GBP integers, and C-19 renders € around them — the money bug at display level. C-32 is therefore split into C-32a (the money path) and C-32b (reads).

**C-32b's shape, decided 2026-09-22: refuse the channel outright.** The alternative offered — keep `de` browsable, omit the price and say why — was declined. The user's words: *"Refuse de, API should honor correct incoming request."* The reading below was confirmed by the user the same day, and is what C-32b built:

- every **storefront-facing** request — GraphQL and `/storefront/*` — scoped to a channel whose currency the price list cannot serve gets a named error, including reads that carry no price;
- the **admin** surface keeps managing that channel (`GET`/`PATCH /admin/channels/:id` and the rest), so an operator can see and fix it;
- a **correct request is honoured unchanged**: unscoped requests and requests in a servable channel (`uk`, every channel of the other tenants) behave exactly as today;
- the rule follows the **currencies, not the key**: if the tenant default itself stops matching the price list (tenant defaults edited to another currency), unscoped requests are refused too, and once `de`'s currency matches, `de` is served.

**C-19a's shape, decided 2026-09-22: a path prefix.** The storefront reaches a channel as `/{channelKey}/…` (`/trade/c/dresses`), and the default channel stays unprefixed, mirroring the api's `/api/{tenant}/{channelKey}/graphql`. Accepted as recommended; domain binding stays out of scope (CHANNEL-MODEL §13).

**A request that names no channel, decided 2026-09-22: required everywhere.** Found while starting C-19b: ADR-0014 §2 made the omitted URL segment the permanent spelling of the default, while §8 and CAVEATS said the fallback expires and "the segment becomes required" — they could not both hold, and no row owned the expiry. Offered: keep the omitted segment as the default for good and expire only header-only absence (recommended), require a channel everywhere, or keep the fallback for good. The user chose **required everywhere**. Consequences, recorded in ADR-0014 §2 and §8:

- every GraphQL path and `/storefront/*` names a channel, the default included; absence becomes a `400` (C-42);
- `GET /system/capabilities` stays unscoped as the discovery point — with no channel named it answers for the default, `channel.key` included;
- the storefront's unprefixed pages therefore learn the default's key there and send it (C-19b), and carts do the same (C-19e);
- enforcement lands last, after every documented command and spec already names its channel (C-41).

### Waiting on the user

1. **Confirm two status rules that were derived in code, not designed** (C-8a): nothing returns to `draft` (otherwise `key` immutability is circumventable by archive → redraft → rename), and `archived → active` is allowed (a market can reopen; safe because the key is already frozen).
2. **Confirm `x-channel-id` carries the channel *key*, not its UUID** (C-12). The header name is the ADR's; the value follows `x-tenant-id`'s precedent of a human identifier. Cheap to change now, expensive once the back office assumes it.
3. **Go-ahead for Block 2** — the auth slice (ADR-0015) and the back office (C-20..C-24). Not started.
4. **CI on this branch** — a PR into `main`, or widening the workflow trigger. Declined for now.

### What can be built next

Re-sequenced 2026-09-22, after C-11 and C-33. Working hours at this build's observed pace, including red-first verification — not a human engineer's figure, which is [CHANNEL-MODEL §12](design/CHANNEL-MODEL.md#12-effort).

| # | Row | Delivers | Est. | Needs |
|---|---|---|---|---|
| **Ordered chain** | | | | |
| 1 | C-32a ✅ | Carts and checkout refuse a channel whose currency the price list cannot serve | done | — |
| 2 | C-32b ✅ | Every storefront request scoped to such a channel is refused with a named error; admin unaffected; a second, servable `t-fashion` fixture channel | done | — |
| 3 | C-18a ✅ | Capabilities per channel; tenant-level fields kept as deprecated aliases; the pricing locale copy stops mattering | done | — |
| 3a | C-18b ✅ | The storefront's cached capabilities invalidated by channel events, not only pricing ones | done | — |
| 4 | C-19a ✅ | The storefront picks a channel from a path prefix; an unknown prefix is a `404` | done | — |
| 5 | C-19b ✅ | Every read in the channel — the default's key discovered from `/system/capabilities` for unprefixed pages; money from the channel's capabilities; C-4's client guard; the cross-channel cache test | done | — |
| 5a | C-19d ✅ | An unservable channel renders "not available in this market", not a `500` | done | — |
| 5b | C-19e | Carts and checkout in the channel, the default's key included, with a cart cookie per channel | 1–1.5 h | C-19b |
| 5c | C-41 | Every documented command and spec names its channel on the storefront surfaces | 1–1.5 h | — |
| 5d | C-42 | The api answers `400` to a storefront-surface request that names no channel | 1–1.5 h | C-19b, C-19e, C-41 |
| 6 | C-30 | `tax_display` editable per channel, honoured by carts and checkout, recorded on orders | 1.5–2 h | C-32a |
| 7 | C-31 | The storefront renders gross or net per channel | 1–1.5 h | C-19b, C-30 |
| **Independent** | | | | |
| 8 | C-34 | Schema-dropping suites serialised by a shared lock — before CI runs on this branch | 0.5–1 h | — |
| 9 | C-28 | Checkout's idempotency made reusable by admin creates; checkout byte-identical | 1.5–2.5 h | — |
| 10 | C-25 | Observability counters | 1–1.5 h | — |
| 11 | C-35 | Creating a tenant creates its default channel | 1–1.5 h | — |
| 12 | C-36 | The search indexer's price scaling for currencies without two decimals — verify, then fix | 0.5–1.5 h | — |
| 12a | C-37 | The currency freeze covers an inherited currency: tenant-default currency edits refused while an inheriting channel has transacted | 1–1.5 h | — |
| 12b | C-38 | Totals and checkout charge the channel's tax rate, and capabilities report it per channel | 1.5–2 h | — |
| 12c | C-39 | CI fails when the committed GraphQL schema or client drifts from the api | 0.5–1 h | — |
| 12d | C-19c | Remove the deprecated tenant-level capability fields (ADR-0014 §7, step 3) | 0.5 h | C-19b |
| 12e | C-40 | The price filter shows the currency's symbol instead of a hardcoded `$` | 0.5–1 h | — |
| **Last** | | | | |
| 13 | C-27 | Docs reconciled; the README run cold | 1.5–2.5 h | all above |
| | | **Remaining, excluding the gated items below** | **≈ 15.5–24.5 h** | |

Gated on the user: **Block 2** — the auth slice (ADR-0015) and the back office (C-20..C-24), ≈ 15–20 h. **Phase H** — per-channel price lists, an ADR first (≈ 2–3 h), the build not sized. **CI on this branch** — ≈ 15 minutes plus whatever it finds.

### Resuming safely

1. **Docker as needed (user direction, 2026-09-22).** Start this project's services only when a step needs them — Postgres alone for database specs, the full stack for live checks — and stop them when done. Quit Docker Desktop only if no other project's containers are running. `down -v` is allowed when a step needs a cold database; destructive specs go to a throwaway `platform_test` database, never the demo one.
2. `curl -s -H 'x-tenant-id: t-fashion' 'http://localhost:3000/admin/channels?limit=10'` should list `de` and `uk`. If the stack is empty, `pnpm seed`, then place two orders through real checkout (the recipe is in [RUNBOOK — Running the live suites](RUNBOOK.md#running-the-live-suites)).
3. After any api change, rebuild with `docker compose build api && docker compose up -d api`, and check a behavioural marker before trusting it — a failed build leaves the old container answering `/ready`.
4. Live suites need `--skipNxCache` and about a minute between them (the api throttles at 200 requests per minute per tenant).
5. `channels.integration` and `checkout.integration` drop schemas the demo depends on. Re-seed after either.

---

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

## Decision gates — G-1..G-3 closed 2026-08-28; G-4 closed 2026-09-22

| Gate | Question | Blocks |
|---|---|---|
| ~~**G-1**~~ | ~~Authentication: prerequisite slice, or gate with a written expiry?~~ **Closed 2026-08-28: prerequisite slice, minimum scope** — the four gateway behaviours ADR-0007 specifies, one operator role, IdP left as configuration. **[ADR-0015](adr/0015-operator-authentication-at-the-api-edge.md) written 2026-08-28** — designed, not built. | ~~C-20~~ |
| ~~**G-2**~~ | ~~URL scoping shape?~~ **Closed 2026-08-28:** `/api/{tenant}/{channelKey}/graphql`, segment omitted for the tenant default, `/api` reserved because tenant ids may be `admin`. Reads only — admin and system stay header-only. | ~~C-2~~ |
| ~~**G-3**~~ | ~~Country/timezone for existing tenants?~~ **Closed 2026-08-28: neither.** The tenants are fixtures we generate, so the seed writes real values and the migration keeps only a trivial safety backfill. No derivation, no review flag. | ~~C-11~~ |
| ~~**G-4**~~ | **Closed 2026-09-22: refuse now (A, C-32), per-channel price lists later (B, Phase H).** The question, as opened: **what does a channel charge when its currency differs from the price list's?** `pricing.prices` holds one currency-less integer per product. A channel can declare EUR while the tenant's prices are GBP — and today checkout charges the *tenant's* currency regardless (seen live: `channel = de \| currency = GBP`). ADR-0014 §9 says a missing price in a channel's currency must **fail** ("falling back to another currency's number is a money bug") while §12 defers per-channel prices — so the spec'd behaviours are *refuse* or *build price lists*, and the unspecified third (relabel the same integer) is the money bug itself. Found 2026-09-19 by C-17's live check; **no row owned it**, and four code comments had wrongly called it "C-18's job". | **C-32**, and through it C-18, C-19, C-30, C-31 |

G-1 was the only one that could change the slice's size, and it did: an auth slice (~1–1.5 weeks) now precedes Phase E. G-2 settled a grammar. G-3 dissolved on inspection — it was careful data-preservation machinery for rows we generate ourselves.

G-1..G-3 unblocked Phase A. G-4's decision is recorded under *Status* at the top of this file.

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

**C-4 — `Vary` extended** ✅ *(the api half; the client guard rides with C-19)*
`graphql-cache.plugin.ts` now emits `Vary: x-tenant-id, x-channel-id` on every GraphQL response, POST included, exported as a `VARY` constant so the specs assert the value the api actually sends rather than restating it.

*Why the channel header is listed even though C-2b put the key in the URL:* the header-only `/graphql` path still exists, still honours `x-channel-id`, and is what the shipped storefront uses until C-19. On that path the header is the only thing distinguishing two channels of one tenant, so `Vary` is what keeps them apart in any cache that respects it. ADR-0014 §2 is explicit that URL scoping is defence in depth *alongside* `Vary`, not a replacement.

*Verified.* The plugin had no spec before this row; it has five tests now, pinning both header names order-insensitively, `Vary` on POST as well as GET, and `cache-control` set on GET only — a POST described as cacheable would let a mutation's response be stored. Dropping the channel header from `VARY` fails exactly `names both scope headers`.

*Split, recorded:* the row's storefront half — `api-graphql.spec.ts` failing if the channel header stops being sent — cannot be built yet, because the storefront does not send `x-channel-id` until C-19. A guard for a header nothing sends would pass vacuously. It lands with C-19, where the client gains the header and the guard has something to guard. The "remove `Vary` and the proxy test fails" check is `scoped-graphql.integration.spec.ts`'s `preserves the cache headers` case, which needs a live api and will pick this up on its next run.

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

**C-9 — Optimistic concurrency** ✅ *(REST; the GraphQL half rides with C-19)*
`version` on write, `409` carrying `currentVersion`, `ETag` on reads and `If-Match` required on writes. Most of this shipped inside C-7, C-8b and C-10 and was verified there; this row closed the gap between "the repository rejects a stale version" and "a client on the wire can actually use it".

*A real bug found while closing it.* `GET /admin/channels/:id` fetched the body and the version in **two separate queries** — three round trips for one read, and a window between them. A write landing in that window yields an `ETag` describing a different version than the payload it is attached to, so a client doing exactly the right thing — read, then send back what it was handed — is either refused forever or overwrites an edit it never saw. A torn ETag inside a concurrency feature. Now one read returns both.
*Verified:* mutating it back to two reads fails `takes ONE store read, not a separate one for the version`. 141 unit tests green.

*Written, not yet run:* `admin-concurrency.integration.spec.ts` asserts the contract over HTTP — a read hands back an `ETag`, that `ETag` matches the body it came with, a stale `If-Match` is `409` **and the first operator's edit survives**, the `409` body lets a client retry without an intervening `GET`, a missing `If-Match` is `400`, and `/admin/tenant-defaults` obeys the same contract so it is a convention rather than a channels feature. Six tests, currently **skipped** — Docker is down.

*GraphQL mutations:* none exist for channels. The row's "required input on GraphQL mutations" has no surface to attach to and lands with **C-19**, which is where the GraphQL half of C-10 was also deferred.

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

**C-11 — Safety backfill** ✅ *(S)*
For any tenant in `pricing.tenant_config` without a channel: `tenant_defaults` from its stored currency, locale and tax rate, plus one inheriting default channel. Stated defaults for the fields with no source (`tax_display = 'net'`, `supported_locales = [locale]`, `country = 'US'`, `timezone = 'UTC'`), commented as defaulted rather than copied. This exists so a database that skipped a re-seed still boots — it preserves nothing of value.
*Verification:* run on a **cold** database as the **non-superuser** with rows visible. Assert a **non-zero** tenant count and exactly one default each. A previous backfill in this project reported `0 = 0` as success because RLS hid the source rows — assert non-zero explicitly, not equality.

*Found while planning it, 2026-09-22:* `ChannelsRepository.findDefault`'s error message already said "the backfill (C-11) guarantees at least one" default channel — a claim about a row that did not exist. Even once built, the backfill covers tenants that exist when it runs: a tenant created later through `PUT /admin/tenant-config` has no channel, and every cart request for it fails. C-11 corrects the message and records the gap in CAVEATS.

*Shipped 2026-09-22* as `channels/0003_safety_backfill.sql`: one channel keyed `web` ("Web Store"), active, default, inheriting every field, for each tenant in `pricing.tenant_config` with no channel at all; currency, locale and tax rate copied, the rest defaulted and commented as such. RLS is lifted with `NO FORCE` on the three tables it touches and restored before the block ends — a migration runs as the owner, and FORCE applies policies to the owner, which is the trap C-33 fell into. Guarded on the three source columns existing, which also covers the table not existing.

*Verified three ways:*

- **The spec** (`apps/api/src/channels-backfill.integration.spec.ts`, 7 tests) runs the file the way the runner does — as `platform`, in a transaction, no tenant bound — against a pre-channels state it builds, then rolls back. It never commits, because the backfill acts on every channel-less tenant and would hand defaults to whatever another suite had half set up. Asserts exactly two tenants backfilled (not `>= 0`), the copied values, a tenant that already had a channel untouched, a second run changing nothing, FORCE back on all three tables *and* an unbound connection seeing nothing, and both skip paths. Each run was on a freshly created database.
- **Seven mutations, each made to fail it, none by failing to run:** the migration doing nothing → `received []`; dropping `NO FORCE` on pricing → `received []`, the silent `0 = 0` shape; dropping it on channels → *"new row violates row-level security policy"*; dropping the FORCE restore → `force: false`; dropping `NOT EXISTS` → *"duplicate key … channels_one_default_per_tenant"* (the boot failure it prevents); no guard → both skip tests; a table-only guard → *"column tc.locale does not exist"*, branding's failure.
- **The real image, on the upgrade path.** The demo database was made to look as `main` left it — `channels` dropped, orders' channel columns and their ledger rows removed, pricing and four orders intact. On the previous image, `POST /storefront/carts` returned **500** for all three tenants (*"tenant t-fashion has no default channel"*). On the C-11 image, same state: **201** for all three, and all five tenants in `pricing.tenant_config` got a `web` default. The same boot showed **0 of 4 orders attributed** to a channel although the defaults now existed and orders migrated after channels — C-33, reproduced on the real image.

*What the boot log also settled:* modules migrate audit → catalog → **channels → pricing** → branding → **orders**. So on a genuinely cold database this backfill takes its skip path, pricing not existing yet; the case it exists for is the upgrade path above.

*Found while running it:* the pricing seed never writes `locale`, so `t-fashion`'s `pricing.tenant_config.locale` is the column default `en-US` while its channel fixtures say `en-GB`, and `capabilities.defaultLocale` reads the pricing copy. The backfill copies what pricing holds, so a backfilled `t-fashion` says `en-US` too. Another drifted copy of one fact; C-18 removes it by composing capabilities from channels, and until then it is recorded here rather than patched in the seed.

**C-33 — Orders' channel backfill that actually runs** ✅ *(S; fixes C-16a — placed beside C-11 because both are the pre-channels upgrade path)*
Orders' `0003_channel_snapshot.sql` backfills `channel_id` on existing orders from the tenant's default channel. Its comment says the migration "runs as the table owner, so it is not subject to the FORCE RLS policy". FORCE means the opposite — it applies policies to the owner — and `platform` is NOSUPERUSER NOBYPASSRLS, and nothing binds a tenant or `app.system_worker`. So the `UPDATE` sees no rows on either table and matches nothing, without an error. Branding's `0001` handles the same trap correctly with `NO FORCE`. Nothing ever checked it against existing orders: C-16a was verified on a cold database, and `checkout.integration` drops `orders` before migrating. Found by reading, 2026-09-22.
The false comment cannot be corrected in place — the runner checksums applied files and refuses to boot on a change — so the fix is a new migration, `0004`.
*Verification:* orders existing before the migration, a default channel for their tenant. "THE BUG": `0003` alone leaves them null — kept green on purpose, because `0003` is immutable and the test says why `0004` exists. "THE FIX": after `0004` they carry the default's id. If `0004` did nothing, the fix test prints `null`.

*Shipped 2026-09-22* as `orders/0004_channel_backfill.sql`, with `0003`'s intent unchanged: an order placed before the tenant had channels is attributed to its default, and `channel_key`/`channel_name` stay null because there was no name at purchase. RLS is lifted explicitly for the transaction — `NO FORCE` on `orders.orders`, which is orders' own table and has no worker clause, and the `app.system_worker` clause for reading `channels.channels`, set transaction-local, so this module does not alter another module's RLS. Only rows whose `channel_id` is null are touched. Guarded on `channels.channels` existing.

*Verified three ways:*

- **Red first.** The spec (`apps/api/src/orders-channel-backfill.integration.spec.ts`, 6 tests) was run against a placeholder `0004` that did nothing: THE BUG green (`0003` leaves the order null, with the default demonstrably present), THE FIX red with `Received: null`. Then the real file: 6/6 on a freshly created database. This spec commits, unlike C-11's: `0004` touches only null-`channel_id` orders, which only this spec creates, and committing is the only way to see a setting outlive its transaction.
- **Seven mutations, each failing it by name:** doing nothing, dropping `NO FORCE` and dropping the worker setting all print `Received: null` — the silent shape of `0003`'s bug, from either side of the join; dropping the FORCE restore → `false`; dropping `channel_id IS NULL` → an order that already named a channel is overwritten; a session-level `set_config` → `Received: "on"` on the pooled connection afterwards, a cross-tenant leak; no guard → *"relation channels.channels does not exist"*.
- **The real image, on the upgrade path**, after C-11's: same pre-channels state, carts `201` and **4 of 4** orders attributed to `web`, key and name null, FORCE back on all four tables. The three images in turn: `500` / 0 of 4 → `201` / 0 of 4 → `201` / 4 of 4.

*`0003` is left as it is.* Its comment is wrong and cannot be changed without breaking every database that applied it; `0004`'s header is the correction, and the build notes record it as a mistake.



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

**C-14 — Read-model in consuming modules** ✅
`ChannelReadModel` in `contracts/` -- framework-free, so every consuming module shares one implementation rather than three growing their own. Fed from the bus by `ChannelReadModelFeeder`, which lives in `src/` because a class in `contracts/` must not know about Nest.

Consumers depend on the **`CHANNEL_QUERY` token**, never on `ChannelsService`. After extraction the token is backed by a read-model over an HTTP client and no consumer changes. Its first consumer is `ChannelScopeMiddleware`, which runs on every channel-scoped request -- the hot path the replica exists for, not a mechanism waiting for a user.

*Verified: the stated check asserts events are an **optimisation**, not a requirement.* Tests come in pairs, because either alone passes a broken implementation:
- **No events at all** -> a channel is still resolved, via read-through. Events-only would reject writes for channels that plainly exist, after a restart or a dropped message.
- **Having read through once** -> the source is then *broken* and the answer still comes back. Read-through without caching passes the first test while quietly reintroducing the per-write query the design removes.
- **An event alone** -> resolves with the source broken from the start, never asking.

Also pinned: misses are **not** cached (caching a null makes a just-created channel unresolvable -- a miss becoming a durable wrong answer); a rename drops the entry filed under the old key; a defaults edit invalidates that tenant *wholesale* while leaving other tenants warm; `listActive` never answers from the replica, because a partial replica cannot answer a completeness question without silently hiding markets.

*Live confirmation:* valid channels `200`, unknown `404`, and **cross-tenant `404`** -- `t-books` asking for `t-fashion`'s `de` is refused, proving the composite key does not leak across tenants.

**C-15 — Reconciliation and TTL** ✅ *verified against a real database*
`ChannelReconciler` reloads every active channel across every tenant on a timer (`CHANNELS_RECONCILE_MS`, default 60s, `0` disables). The interval **is** the staleness bound: after a dropped event the replica is wrong for at most one interval.

*The gap it closes, demonstrated rather than asserted.* `THE GAP: a dropped archive leaves a stale hit that read-through cannot fix` archives a channel directly in the database — no service call, so no event — and shows the replica still resolving it, with `sourceReads` still at 1. A hit never asks the source, so read-through structurally cannot notice. That test **passes against the bug on purpose**; it is the demonstration, and the next test is the fix.

*The `0 = 0` guard, and it fires.* The reload binds `app.system_worker` transaction-locally, exactly as `audit.webhook_outbox` does. Removing that one line fails **2 of 5** tests including `reads a NON-ZERO count` — without that assertion a blinded reconciler would reload nothing, replace nothing, and report success. A companion test asserts the same query returns **zero** rows *without* the binding, so the RLS clause is proven load-bearing rather than assumed.

*A zero-row read is refused, not applied.* The reconciler cannot distinguish an RLS-blinded read from a genuinely empty database, and the safe answer to both is to change nothing and log loudly. Wiping a warm replica on a blinded read would convert the fault into a read-through storm against a database that then answers correctly — masking the very problem.

*Two bugs found by running it:*
- **`toISOString is not a function`.** A raw postgres-js connection does not necessarily return `timestamptz` as a `Date`; the tenant-bound Drizzle path this module otherwise uses hides that difference. Coerced through `new Date()`, which is correct for either representation.
- **A test that depended on the previous test's state.** `reconciliation removes it` asserted a stale hit on a *fresh* read-model, which reads through and correctly sees the archive. It now manufactures its own staleness — warm the replica, archive behind its back — so it is self-contained.

`replaceAll` swaps the maps atomically rather than clear-then-fill, so no request ever observes a half-built replica and the reconciler cannot become the cause of a periodic latency spike.

**C-16a — Orders carry and snapshot the channel** ✅ *verified on a cold database*
`channel_id`, `channel_key`, `channel_name` and `currency_minor_units` on `orders.orders`, written at checkout from the resolved channel. A copy, not a reference — the same discipline as the price and promotion snapshots already in 0001.

*Split from C-16 on discovery:* **carts live in Redis, not Postgres**, so "channel_id on both" is two different mechanisms and, by this file's own "needs the word *and*" rule, two items. Cart is C-16b.

*Verified:* rename a channel after an order exists and the order still renders `Web Store` while the channel reads `Renamed Store` — re-read from storage, not from the in-memory object, which could hold a stale copy and pass regardless. Mutating the snapshot to store nulls fails 2 tests. The check also asserts the rename *actually happened*, so it cannot pass on a rename that silently failed.

*Three things found by building it:*
- **The boundary rule forced a better design.** Orders cannot import `CHANNEL_QUERY` from `channels/src` — `type:src` may depend only on `scope:shared` and `type:contracts`. The token moved to `contracts/`, beside the interface it provides, which is where a public DI token belongs anyway. `ChannelsModule` became `@Global`, matching Pricing and Cart.
- **The migration needed a cold-boot guard.** It reads `channels.channels`, which may not exist yet when orders migrates first. Guarded on `to_regclass`, following branding's precedent — and *proven* by applying orders' migrations to a database with no channels schema and watching the columns appear anyway. Migration order is genuinely insignificant, rather than assumed to be.
- **The fixtures contradicted each other, and the snapshot exposed it.** A live order read `currency: USD` next to `"key": "uk"` — because `pricing-seed` hardcoded USD for every tenant while `channels-seed` said `t-fashion` was GBP, and taxed `t-electronics` at 725 bps where its channel said 625. Two copies that had drifted with nothing comparing them. `pricing-seed` now derives both from the channel fixtures, so the class of problem is gone rather than the instance. **This does not unify currency *resolution* in the api** — checkout still charges in `pricing.tenant_config.currency`. (This sentence originally ended "that is C-18". It is not: C-18 is capabilities-only, and no row owned it until C-32, which is blocked on gate G-4.)

*Backfill is honest about what it cannot know.* Existing orders get `channel_id` from the tenant default (the tenant had exactly one selling context, which is what the default represents) but `key` and `name` stay **null**: at purchase the channel did not exist, so there is no historical name, and copying today's would be indistinguishable from a real snapshot.

**C-16b — Carts are channel-bound** ✅
A cart stores the concrete id of the channel it was created in, and every operation that loads it — read, add, requantify, coupon, and checkout via `get` — refuses a request in any other channel. Checkout snapshots the **cart's** channel rather than the request's.

*The verification was rewritten, because the original could not fail.* It asked to assert that "the resolved currency on a cart read follows the cart's channel". Pricing is still tenant-level until C-18, so both of `t-fashion`'s channels price in GBP and that assertion passes whether or not binding exists. What *is* falsifiable today is the binding itself; the currency half moves to C-32 (originally misattributed to C-18 — see G-4).

*Verified — 15 unit tests, run against the REAL `CartRepository` over an in-memory Redis:*
- **Removing the check** fails 11, including each of the five operations **by name**. The 4 that survive are creation and the allowed-channel case, which do not depend on refusal.
- **Dropping `channelId` in the repository's `save`** fails exactly `carries channelId through a save`. That is the bug a fake repository would have hidden: `save` rebuilds the stored object field by field, so an omission there unbinds a cart on its *first* mutation, after which every other check passes while the cart is usable from anywhere.
- Rejections assert **no write happened**, not merely that an error was thrown.

*Live over HTTP:* a cart created in `de` reads `200` in `de`, `400` in `uk`, and `400` with **no** channel header — absent means the tenant default, not "any channel". The `400` body carries both `cartChannelId` and `requestChannelId`.

*Decisions recorded:*
- **The concrete default id is stored, never "default".** A cart built on the default stays on *that* channel if another is later promoted, rather than silently changing market mid-basket. The cost: a headerless storefront's in-flight carts are refused after a default promotion, and must start again. Correct — pricing an existing basket under a new market is the failure — and rare, and carts expire in 24h.
- **`400`, not `404` or `409`.** `404` would follow the cross-tenant precedent, but channels are deliberately not a trust boundary (ADR-0014 §1), and hiding the cart would make a dropped header look like data loss. `409` means a version conflict here and carries `currentVersion`; a client retrying 409s would loop on a mismatch no retry can fix.
- **Legacy carts** (written before the field existed) read back as `channelId: null` — never `undefined`, which would make the key appear and vanish by cart age — and are treated as the default.

*Conformance:* `channelId` added to the storefront's pinned cart keys **in the same commit that added the field** — the order the C-16a omission taught. Storefront 38/38, checkout integration 7/7, and after a re-seed the api live specs 45 conventions / 6 concurrency / 19 scoped-graphql.

*Not tested, stated so nobody assumes it was:* "checkout snapshots the cart's channel rather than the request's" has no discriminating test, because binding makes the two equal by the time checkout runs — any test would pass either way. The change is defensive; it makes the agreement a design property rather than an accident of ordering.

**C-17 — `orders.created` sets `has_transacted`; currency frozen** ✅ *verified against a real database*
`ChannelTransactedConsumer` subscribes to `orders.created` and marks the channel named in the order's snapshot. The rule it arms — C-8a's `currency.frozen` — already existed and was already tested; until this, the flag never became true and the rule could never fire.

*The event is sufficient on its own.* Since C-16a the payload carries the channel snapshot, so no read back into orders is needed — which the architecture forbids anyway.

*Verified — the stated check, in both directions:* before any order the currency edit **succeeds** (so the rule is not refusing everything); after an order in that channel it is rejected with `currency.frozen`, a rename still succeeds, `version` is unchanged, and a bystander channel nobody ordered in stays unfrozen. Two mutations:
- **Unwiring the consumer** fails the freeze test — literally the row's "before the consumer is wired, the change succeeds".
- **Removing `AND has_transacted = false`** fails exactly the redelivery test, which asserts `updated_at` does not move on a second delivery.
A forged event — tenant `t2` naming one of `t1`'s channels — marks nothing: the tenant is bound from the event and RLS scopes the write.

*What running it taught, which reading could not:* **the bus is asynchronous.** `publish()` schedules handlers on a microtask and returns, so `checkout()` resolves *before* the mark commits. The first run read the flag straight after checkout and saw `false` while the consumer's own log line said it had marked the channel — the test was wrong, not the consumer, and so was a sentence in the consumer's doc comment claiming the handler "happens to run within the request". Both corrected. It also vindicates binding the tenant **from the event** in the consumer's own transaction (the outbox precedent): the ambient request connection can be released before the handler runs, so using it would be a race that passes whenever the handler wins. The repository's ambient-context `markTransacted`, written speculatively in C-7, was retired so there is one way to do this, not two.

*Decisions:* `version` is **not** bumped — this is not an operator edit, and a bump would 409 an in-flight rename for a change it did not conflict with, where the un-bumped path gives the far more useful `400 currency.frozen`. The freeze is **eventually consistent** with two stated windows (milliseconds after a first order; until the next order if an event is dropped — the conditional UPDATE makes every later order re-attempt the mark). Both are in CAVEATS, which the consumer's comment promised and which is now true.

*Live over HTTP, against a rebuilt image:* on freshly-seeded `de`, `PATCH currencyCode` succeeds twice with `hasTransacted: false`; an order is placed in `de` through real checkout; the same `PATCH` is then `400 ["currency.frozen"]` while a rename is `200`, with `hasTransacted: true`. Fixture values restored afterwards.

*What that live run also showed, and it is not C-17's to fix:* the order came back `channel = de | currency = GBP`. Checkout still charges in the tenant-level `pricing.tenant_config.currency`, so today the freeze protects a value checkout does not yet use. The freeze is still correct and still necessary — it is the precondition for charging per channel safely — but it only becomes *meaningful* once totals and checkout resolve currency from the channel. **No row in this backlog owned that**; see C-32.

---

## Phase D — API surface

**C-18 — Split 2026-09-22 into C-18a and C-18b.** Changing where capabilities come from also changes what must invalidate the storefront's cached copy of them, and that is a second deliverable with its own check.

**C-18a — Capabilities describe the request's channel** ✅ *(M)*
Stays in the composition root (ADR §7): it also reports `apiVersion` and the deployment feature map, which no domain module should own. What changes is its source — it composes from the `channels` contract instead of reading pricing config directly. Channel-scoped fields added; tenant-level fields kept as `@deprecated` aliases resolving the default channel.
*Verification, as first written:* deprecated and new fields agree for the default channel, and **t-fashion's two channels** (GBP and EUR, via C-11a) make a constant-wired alias diverge — a single-channel tenant passes even if the alias ignores the channel entirely. Codegen drift check fails if the committed client copy is stale.

*Shipped 2026-09-22.* `Query.capabilities` (and its REST twin, one class) gains `channel` — key, name, isDefault, currency, minor units, locale and locales, country, timezone — for the channel the request is in: the one it named, else the default; `null` only for a tenant with no channel. `currency`, `currencyMinorUnits`, `defaultLocale` and `locales` are `@deprecated` and answer for the **tenant default** even when the request names another, which is what they always meant. The hand-kept minor-units table is gone; `minorUnitsFor` derives them from the currency (KWD is 3, where the table said 2). "Which channel is this request in" moved into one helper, `apps/api/src/request-channel.ts`, now shared with C-32b's middleware.

*Deliberately not moved:* `taxRateBps` and `taxDisplay`. They describe the money path, and the money path still charges the price list's rate and adds tax on top whatever a channel is configured with. Advertising a channel's own rate would describe a tax nobody charges — G-4 again, for tax. They move when **C-38** (rate) and **C-30** (display) make them charged per channel. `currency` has no such problem: since C-32 an unservable channel is refused before capabilities answer.

*Verified:*

- **Unit, 9**, with a second channel (`jp`) differing from the default in every field, so each alias fails by name if it follows the wrong channel. **Six mutations** each failing named tests: aliases following the request; `channel` describing the default; tax from the channel; the minor-units table's fallback; locale from the pricing copy; the shared helper swallowing every failure (caught through both its users).
- **Live, 24 expectations, 0 failures:** unscoped `t-fashion` → `uk`, GBP, **`en-GB`** — the pricing copy said `en-US`, the drift C-11 recorded, now gone from capabilities; aliases equal the channel; REST equals GraphQL. Scoped to `trade` by header and by URL, `channel` is `trade` while the aliases stay `uk`'s. `t-books` → `us`; a tenant with no channel → `channel: null`, described from its price list. Made live: `trade` given `en-IE` shows it in `channel` while the alias stays `en-GB`. `de` still `422`.
- **Contract:** schema, GraphQL client and REST client regenerated from the running api; storefront build and lint clean, conformance 38/38 — it still reads the deprecated fields and migrates in C-19b. scoped-graphql 19/19.

*The row's first check, rewritten:* the two channels could not be `uk` and `de` — `de` is refused since C-32b — and `uk` and `trade` agree in every aliased field. The divergence is therefore made in the unit tests with a channel differing in every field, and live by giving `trade` its own locale for the duration of the check. And **no GraphQL codegen drift check exists** — CI checks only the REST half (R-4) — so that part of the row could not run as written: **C-39**.

*Found by it:*
- **A channel's tax rate is configuration nothing charges.** With `trade` set to `taxRateBps: 0` through admin, a cart in `trade` was taxed at 875 bps. Opened as **C-38**, in CAVEATS.
- **The `fetch-schema` target corrupted every non-ASCII character.** It piped `docker compose exec … cat` through Windows PowerShell 5.1, which decoded UTF-8 by the console codepage and wrote `’` as `ΓÇÖ` — and added a BOM and CRLF. The schema had held no non-ASCII until these descriptions. It is now `docker compose cp`, byte for byte, so the committed schema also loses its BOM. `pnpm codegen` failed once during this, and passed on two re-runs; the cause was not found.

**C-18b — The storefront's cached capabilities follow the new source** ✅ *(S)*
Before C-18a the storefront's `capabilities:<tenant>` cache tag was invalidated by `pricing.tenant-config.updated`, because pricing was the source. It is now the channels module, so a channel or tenant-defaults edit must invalidate it too, or the storefront keeps a stale locale for up to an hour. The api forwards `channels.updated`, `channels.default-changed` and `channels.tenant-defaults.updated` to the storefront webhook; the storefront's revalidate route refreshes the capabilities and browse tags on them.
*Verification:* a unit test of the route's event-to-tag mapping; and live, edit the default channel's locale and watch a product page re-render in the new format within seconds. On the C-18a image alone it stays in the old format.

*Shipped 2026-09-22.* The api's webhook dispatcher forwards `channels.updated` and `channels.tenant-defaults.updated` when they changed something — a no-op `PATCH` must not drop every cached page for the tenant — and `channels.default-changed` always. Any channel's edit, not only the default's: over-invalidating is the safe direction, and after C-19 every channel's matters. The storefront's revalidate route drops the capabilities tag and the browse tags on them; not the theme, which is not a channel property. The capabilities tag is now built by one `capabilitiesTag()` in `cache-tags.ts` rather than spelled out in three places.

*Verified:*

- **The "before", recorded first, on the C-18a image:** tenant defaults set to `de-DE`; the api reported `de-DE` within a second; a `t-fashion` product page kept rendering **`£143.94`** for all 20 seconds of polling.
- **After, same script:** the page rendered **`143,94 £`** within about 2 seconds, and returned to `£143.94` after the restore. Both webhooks delivered on their first attempt (`audit.webhook_outbox`).
- **Unit:** api 5 (which channel events become a webhook owed, a no-op edit does not, pricing unchanged) and storefront 8 (each channel event drops capabilities and browse, not the theme; an unknown event still does nothing — the path channel events used to take). **Three mutations** each failing named tests, across both deployables.
- **Suites:** api unit 27, storefront 46 including conformance; lint and build clean on both; the four live suites — counts in the status section.

**C-32 — Split 2026-09-22 into C-32a and C-32b.** G-4 closed with option A: refuse a channel whose currency the price list cannot serve. `pricing.prices` holds one currency-less integer per product, in the currency of `pricing.tenant_config`; a channel is **servable** when its resolved currency equals that. Per-channel price lists, which would make every channel servable, are Phase H.

**C-32a — The money path refuses an unservable channel** ✅ *(M, 2–2.5 h)*
`TotalsService.compute` reads currency and tax rate from `pricing.tenant_config` and consults no channel, so a cart or order in `de` is priced and charged as the tenant default. It gains the cart's channel currency as an input and refuses, with a named error, when that differs from the price list's; cart creation refuses early for the same reason. One check covers cart totals and checkout, because checkout re-runs the same function inside its transaction. It must also catch an unservable **default** — tenant defaults edited to another currency — which a header check alone would miss.
*Verification:* `t-fashion`'s two channels, identical cart contents. Today both orders read `currency: GBP`. After: `uk` charges GBP; `de` is refused with the named error, **no order row and no cart write**. Removing the check brings back `de` charging GBP-denominated integers — the symptom seen on 2026-09-19. One channel per tenant cannot fail this.

*Shipped 2026-09-22.* The rule is one pure function in `pricing/contracts` — `unservableChannel(priceListCurrency, scope)`, `null` or the reason — and one exception in `pricing/src`, `UnservableChannelException`: **`422`**, code `channel.unservable`, the envelope extended with `channel`, `channelCurrency` and `priceListCurrency` (ADMIN-API.md §2). `TotalsService.compute` now takes a required `scope` and refuses before reading a price; a new `assertServable` refuses before there is anything to price. The cart asks at creation, before writing, and prices a basket in **its own** channel. Checkout needed no code: it reaches money only through `cart.get`, which runs before a promotion is reserved — now said in a comment there, so nobody reorders it away. `PricingScope`'s fields match `ChannelConfig`'s names, so a resolved channel is passed as it is, with no mapping for each consumer to keep in step, and pricing still does not depend on channels.

*Verified:*

- **Unit:** pricing 10 new (the rule, `compute`, `assertServable`, each refusal paired with an allowed case, and "refuses before reading a single price or promotion"); cart 6 new, against the real `CartRepository` (a refused create writes nothing; the question is asked with the request's channel, or the default; a cart is priced in its own non-default channel; one whose channel stopped being servable, or stopped resolving, is refused).
- **Integration, `checkout.integration`, 13/13:** identical baskets — the USD channel gets an order in USD, the EUR channel is refused before a cart exists, with the cart and order counts unchanged; and a cart built while its channel was servable is refused at checkout once it is not, with **no order, no promotion use, and the cart kept**.
- **Five mutations, each failing named tests, none by failing to compile.** The one that matters most: with `compute`'s check removed, checkout wrote an order in the now-EUR channel **charged `"currency": "USD"`** and consumed the promotion — G-4's bug, reproduced and caught.
- **Live, on a rebuilt image:** `POST /storefront/carts` in `de` → `422` with the body above; in `uk` and unscoped → `201`; the RUNBOOK recipe → orders in `uk`, `GBP`. REST client regenerated (three `422` entries, nothing else), storefront build and conformance 38/38.

*Found by it:* the C-17 freeze test edited its channel's currency to EUR and then placed an order there against a USD price list — G-4's bug, inside a test about something else. It now edits away and back, which still proves the currency is editable before a first order.

*Not refused here, on purpose:* adding or requantifying lines in a cart whose channel became unservable after creation. Nothing is priced by those, and reading or checking out the cart is refused. C-32b refuses the request itself.

**C-32b — Every storefront request in an unservable channel is refused** ✅ *(M, 2–3 h; the reading of the decision, confirmed by the user, is under Status)*
A request edge check, after channel resolution, on the storefront surfaces only — GraphQL and `/storefront/*` — returning a named error that says why. Admin is untouched, so the channel can be fixed. Status code chosen at build, and not `409`, which means a version conflict here.
*Verification:* for `de`: search, product detail, capabilities and `POST /storefront/carts` each return the named error; for `uk` and unscoped requests, the storefront conformance suite and scoped-graphql still pass unchanged — the correct request honoured; `GET /admin/channels/:id` for `de` still `200`. Then make `de` servable (its currency set to GBP, possible because nothing can have transacted in it) and the same reads succeed — proving the refusal follows the currencies, not the key. Removing the check lets a `de` search return GBP figures, the precondition for € around GBP.
*Consequence for later rows:* `de` stops being usable as the second channel in positive tests. C-18's alias check and C-30/C-31's gross-versus-net control need two channels that are both servable and differ in configuration. C-32b adds one — proposed: a GBP `trade` channel for `t-fashion`, which is also the natural net-priced counterpart to a gross `uk` in C-30.

*Shipped 2026-09-22.* `ChannelServabilityMiddleware`, in the composition root, runs after channel scope and asks pricing's `assertServable` about the request's channel — the one it named, or the tenant default — so the edge and the money path share one rule, one exception and one body. Mounted on `graphql`, `storefront/*` and `system/capabilities` (the REST twin of the GraphQL query, which must not answer differently); not on admin. It refuses only a *known* mismatch: a tenant with no price list, or with no default channel at all, passes as before. The latter is a new typed `NoDefaultChannelError` in the channels contracts, so a database failure while finding the default still surfaces instead of being waved through. The `findDefault` contract no longer claims every tenant has a default. Seed: `t-fashion` gains `trade`, GBP, not the default.

*Verified:*

- **Unit, 7 tests** — scoped and unscoped, servable and not, the no-default pass-through, and an unrelated failure not swallowed. Refusals assert `next()` was **not** called. **Four mutations**, each failing named tests: never checking the default; swallowing every failure; never asking; and serving before checking.
- **Live, a script of 28 expectations, 0 failures.** Every surface refuses `de` with `422 channel.unservable`: GraphQL search by header, by scoped URL and over POST, product, capabilities, `/system/capabilities`, cart create, read, add-item, coupon removal and checkout — the last three on routes nothing but this middleware can refuse, which otherwise answer `404` for a cart that does not exist. `trade` (servable, not the default), `uk`, unscoped `t-fashion` and another tenant are all served. Admin still reads `de` even when sent `x-channel-id: de`. Setting `de` to GBP serves it; back to EUR refuses it. Setting the tenant default to EUR refuses unscoped requests; back to GBP serves them. A tenant with no channels (`t-onboard`, created through `PUT /admin/tenant-config`) is still served.
- **Existing suites:** checkout 13, the two backfill specs, channels 168 (with the database), storefront conformance, admin-conventions, admin-concurrency and scoped-graphql — counts in the status section.
- **Cost, server-side:** median 4.0 ms, p90 5–6 ms for an unscoped read, against 4.5 / 6.0 ms on the C-32a image — within noise at the log's 1 ms resolution. Client-side timings on Docker Desktop for Windows swing by 2x between container restarts and cannot compare builds.

*What the live check caught, and the unit tests could not:* the first build mounted the middleware on `storefront/(.*)`. Express's path-to-regexp (0.1.13) compiles `(.*)` after a slash as `(?:\.(.*))` — a literal dot — so the route registered cleanly and guarded nothing. `POST /storefront/carts` still answered `422`, but from C-32a's cart check, which hid it; the add-item and coupon probes, which only the middleware can refuse, exposed it. Now `storefront/*`, with a comment on why.

*Also found:* C-17's currency freeze does not cover an **inherited** currency. `uk` inherits GBP; after an order in `uk` marked it transacted, `PATCH /admin/tenant-defaults {currencyCode: EUR}` was accepted and `uk` resolved to EUR. The freeze checks only a channel's own `currency_code`. C-32 now turns the consequence into a refusal rather than a wrong charge, but the rule claims more than it enforces — C-37.
*Both must land before C-18.* A storefront that sends channel scope on every read would otherwise render `de` with € formatting around GBP integers — the money bug, at display level.

**C-19 — Split 2026-09-22 into C-19a and C-19b.** Too large for one row once its inherited pieces are counted, and part of it is undesigned.

**C-19a — The storefront picks a channel** ✅ *(M, 2–3 h; shape decided 2026-09-22)*
Storefront domain binding is outside the design (CHANNEL-MODEL §13), so nothing yet said how a shopper reaches `trade` rather than `uk`. **Decided: a path prefix** — `/{channelKey}/…`, the default channel unprefixed, mirroring the api's `/api/{tenant}/{channelKey}/graphql`. The middleware takes the key from the path beside the tenant from the host; links keep the prefix the page was reached under. The storefront's own first segments (`c`, `p`, `cart`, `orders`, `api`) are never read as a channel key.
*Verification:* the same page under two prefixes resolves two channels; an unknown prefix is a `404`, never the default.

*Shipped 2026-09-22.* The middleware reads the first path segment as a channel key unless it is one of the storefront's own routes, rewrites to the unprefixed route, and passes the key on as `x-channel-key` after deleting any inbound copy. Every page moved into a `(shop)` route group — URLs unchanged — whose layout asks the api for the channel's capabilities under the scoped URL, `/api/{tenant}/{key}/graphql` with `x-channel-id`, and turns the api's `404` into the storefront's. Links, form actions, the checkout redirect and the suggestions fetch keep the prefix; the footer names the resolved channel. Reads other than that one stay unscoped: C-19b.

- **Unit, 38 new:** channel grammar 27, including one that fails when a top-level route is added without being reserved; middleware 7; read path 4. Four mutations, each failing its tests: the inbound-header delete removed (1 failure), the key re-encoded in the api URL (1), the error's status dropped (1), `orders` unreserved (3).
- **Live, production build against the api:** `/`, `/c/dresses`, `/p/…` and `/cart` resolve `uk`; the same four under `/trade` resolve `trade`, with every link and form action on the page under `/trade` (60 on the home page); `/uk/c/dresses` resolves `uk`; `/xx`, `/xx/c/dresses` and an archived probe channel's key answer `404`; a client-sent `x-channel-key: trade` on `/c/dresses` still resolves `uk`. Suggestions, a client-side navigation (an RSC request) and an order page all answer under the prefix. The same probe repeated against the rebuilt storefront image (`docker compose build storefront`, 3 min 14 s) gave the same answers. Conformance 7/7; build and lint clean.
- **What it printed with the change doing nothing:** before C-19a, `/trade/c/dresses` was a `404` exactly like `/xx/c/dresses` — no such route — and no page named a channel. The contrast that proves resolution is `/trade` answering `200` in `trade` while `/xx` answers `404`.
- **`de` answers `500`.** The api refuses it with `422 channel.unservable` and nothing renders that refusal yet; that is C-19b's.

*Found building it:*
- **`notFound()` in the root layout answers `404` with an empty page.** The first build resolved the channel there. The status was right, so a status check passed; the page carried no layout and no message, because the root layout sits outside its own not-found boundary. Found by comparing the RSC payload against the product page's `404`, which carries both, then confirmed by rendering both in headless Edge. Hence the route group: thrown one level down, the `404` is drawn inside the layout like any other.
- **The price filter hardcodes `$`**, seen in the same browser render: **C-40**.
- The two costs of the prefix — channels keyed `c`, `p`, `cart`, `orders` or `api` are unreachable by it, and `/uk/…` duplicates the default's unprefixed pages — are in [CAVEATS](CAVEATS.md#the-storefronts-channel-prefix-has-two-costs).

**C-19b split 2026-09-22, before it was started.** As written it carried three deliverables — scoped reads, the refusal page, and carts in the channel — and the third was not in its 1.5–2 h estimate at all: it surfaced while building C-19a. Split by the sizing rule into C-19b, C-19d and C-19e, together 2.5–4 h.

**C-19b — Every read in the channel** ✅ *(M, 1.5–2 h; widened 2026-09-22 by the required-everywhere decision)*
Every GraphQL read goes to the scoped URL with both headers, for the request's channel: `graphqlQuery` reads the channel as it reads the tenant, rather than each caller passing it. An unprefixed page reads in the default channel **by its key**, learned from `GET /system/capabilities` and cached under the capabilities tag, so no read relies on the fallback C-42 removes. Money is formatted from `capabilities.channel`, falling back to the tenant-level fields only for a tenant with no channel at all. Carries C-4's client guard — `api-graphql.spec.ts` failing if the channel header stops being sent, which only now has something to guard. `getMoneyFormat` and `lookupChannel` then issue one memoised fetch. C-9's and C-10's GraphQL halves stay deferred unless a consumer needs them: the storefront reads channels through capabilities and mutates none.
*Verification:* the contract-conformance job, plus a cache test: `uk` and `trade` made to differ for the duration (`trade` given `de-DE`), the same page requested in sequence — each renders its own formatting, and the second never returns the first's. With the change doing nothing, `/trade` renders `uk`'s `en-GB`.

*Shipped 2026-09-22.* `graphqlQuery` names the request's channel on every read, in the URL and `x-channel-id`, reading it per call as it reads the tenant; the per-caller option C-19a added is gone. `requestChannelKey` is the path's key, or for an unprefixed page the default's key from `GET /system/capabilities` — sent with no channel, tagged `capabilities:<tenant>`. `getMoneyFormat` formats from `capabilities.channel`, reading the deprecated tenant-level fields only for a tenant with no channel. `Capabilities` joins the api-client's curated REST names.

- **The cache test, red then green.** `trade` given `de-DE` through admin, confirmed by the api (`channel.defaultLocale` `de-DE` in `trade`, the alias still `en-GB`). The C-19a image, reads unscoped: `/`, `/trade`, `/`, `/trade` all rendered `£143.94`. The C-19b image, same sequence: `£143.94`, `143,94 £`, `£143.94`, `143,94 £`. Restoring inheritance (`null`) put `/trade` back on `£143.94` within three seconds, so the webhook still reaches channel-scoped entries.
- **No read relies on the fallback.** Over those four page loads the api received no unscoped `/graphql` at all: the unprefixed pages read `/api/t-fashion/uk/graphql`, and `/system/capabilities` was asked once — discovery served from cache.
- **Unit, 85** (8 new): the read path's channel guard, per call and in both halves; discovery, including that it names no channel and surfaces a refusal rather than reading unscoped; money from the channel. Six mutations, each failing its tests: header dropped (3 failures), reads never scoped (3), no discovery for the default (2), discovery sending a channel (1), money from the aliases (1), the 404 frame's default-channel read ignored (1).
- **C-19a's probe re-run on the final image:** every row as before. Conformance 7/7; `t-electronics` and `t-books` render; build and lint clean.

*Found building it:* **the first build turned an unknown channel's `404` into a `500`.** The root layout also reads the theme, and scoped to an unknown key the api answers that read `404` too, so the frame crashed before the `404` page could draw. No unit test covered the layout; re-running C-19a's live probe caught it. The frame now reads its theme in the default channel (`inDefaultChannel`), where its links already go.

**C-19d — An unservable channel says so** ✅ *(S, 0.5–1 h)*
C-32b's `422 channel.unservable` rendered as an honest "not available in this market" inside the layout, instead of a server error. It hooks into `lookupChannel`, which rethrows the `422` today. Decide when building: a page in Next's app router can answer `404` or `200`, not `422`.
*Verification:* `/de/c/dresses` renders the message; today it is a `500`. `/trade` is untouched, so the message is not shown to every channel.

*Shipped 2026-09-23.* `lookupChannel` answers with one of three states — serves, unknown, unservable — instead of throwing the api's `422`, and `(shop)/layout.tsx` turns the third into the market's own page, returned *instead of* its children so nothing underneath asks a question the api has already refused. The page carries the tenant's frame, names the channel, and links to the default channel.

**Decided while building: `200` with `noindex`, not `404`.** Next's app router gives a page those two answers and no third, so the api's `422` cannot be passed through. `404` would tell a shopper with a valid link that the page does not exist; `200` tells them the market is not open, and the segment's `noindex` keeps it out of search results, which is what the `404` would have bought.

- **Live:** `/de`, `/de/c/dresses`, `/de/p/<id>` and `/de/cart` all answer `200` with the message, `noindex`, the tenant's brand and the main-store link; `/`, `/trade` and `/uk/…` are unchanged; `/xx/…` is still `404`. Before this row every `/de` path was a `500`.
- **The unservable *default*, the harder half:** `t-books` defaults switched to EUR against a USD price list, so every read including discovery is refused. `/` renders the message with the neutral fallback theme and *no* main-store link — there is no other market to offer — rather than a `500`. Restored to USD afterwards, and `t-books` renders its own brand again.
- **Unit, 99** (13 new): the three outcomes, including a refusal that arrives from discovery as an `ApiError` rather than from a query, and that anything else still throws; the frame's fallback theme, pinned because C-37 will remove the live reproduction; the product page's metadata. Five mutations, each failing its tests: `422` unrecognised (2 failures), the discovery refusal missed (1), every error read as a closed market (2), no fallback theme (1), the metadata read unguarded (2).
- Conformance 7/7 (106 storefront tests over 12 suites); build and lint clean.

*Found building it:* **the product page lost its `<title>` and `robots` tag in a refused channel.** `generateMetadata` resolves separately from rendering, so it still ran where the page no longer did, threw the `422`, and Next swallowed it: `200`, the right body, and no metadata at all — the segment's `noindex` silently gone. Caught because the probe checks `noindex` on every page rather than once per feature. Metadata now asks `lookupChannel` before it reads.

**C-19e — Carts and checkout in the channel** *(S, 1–1.5 h)*
The REST calls — cart create, add, coupon, checkout — carry `x-channel-id`, the default's key included (C-19b's discovery), and the `cart_id` cookie gains the channel in its name. Carts are bound to the channel they were created in (C-16b); a per-tenant cookie carries a cart started under `/trade` into `/`.
*Verification:* a cart started under `/trade` is a `trade` cart in the api, and `/` starts its own. Today both pages share one cart, bound to `uk`.
*Carried from C-19b:* the header's cart icon renders in the root layout, including around an unknown channel's `404`. Once carts are scoped it must read the default channel's cart there, as the theme does (`inDefaultChannel`), or the `404` becomes a `500` again.

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

**C-26 — CAVEATS entries** ✅
A `## Channels` section in [CAVEATS.md](CAVEATS.md) with eight entries: the missing-channel fallback and its expiry, one-currency-per-channel, formatting-not-translation, the flat tax rate and its named provider seam, cache cardinality, the unbounded read-model, auth as an unbuilt prerequisite, and the fact that nothing on this branch has run in CI.

Two beyond the six the row asked for, both because a claim elsewhere depended on them: `ChannelReadModel`'s doc comment says *"CAVEATS records that"* about its unboundedness, which was false until now; and every "verified" line in this file rests on one machine, which is worth stating where someone reads the honest list rather than only here.

*Verification:* the factual claims were checked against the source rather than written from memory — the CI trigger really is `push:[main]` + `pull_request:[main]`, `tax_rate_bps` really is nullable (the seam a tax provider would replace), both cited `scoped-graphql` assertions exist, and both document links resolve.

**C-34 — Schema-dropping suites serialised** *(S, 0.5–1 h; added 2026-09-22)*
CI runs every project's tests at once against one database, and jest runs spec files in parallel within a project. Nothing stops `checkout.integration` dropping `channels` while `channels.integration` is using it. Each destructive suite takes one shared Postgres advisory lock in `beforeAll` and releases it in `afterAll`. Found while writing C-11's spec; recorded in CAVEATS.
*Verification:* two destructive suites started together run one after the other — their `beforeAll`/`afterAll` timestamps do not overlap. Without the lock they overlap.

**C-35 — Creating a tenant creates its default channel** *(S, 1–1.5 h; added 2026-09-22)*
C-11 gave a default channel to every tenant that existed when it ran. A tenant created afterwards through `PUT /admin/tenant-config` has none, and every cart request for it fails. Onboarding writes the tenant defaults and one default channel, through the channels contract rather than a cross-module write.
*Verification:* a new tenant via `PUT /admin/tenant-config`, then `POST /storefront/carts` — `201`. Today it fails with *"has no default channel"*.

**C-36 — Index prices scaled by the currency's minor units** *(S, 0.5–1.5 h; added 2026-09-22; predates this slice)*
`product-indexer.service.ts` writes the denormalised `price` attribute as `unitPriceCents / 100` — two decimals whatever the currency. For JPY (zero decimals) or KWD (three) that reads as wrong by a factor of 100 or 10 after an admin price change. Not yet reproduced: verify first, then scale with `minorUnitsFor`. The seed's own price path needs the same check.
*Verification:* a JPY tenant, a price set through `POST /admin/prices`, and the index holding the same number of yen. Today it would hold a hundredth of it, if the reading is right.

**C-37 — The currency freeze covers an inherited currency** *(S, 1–1.5 h; added 2026-09-22)*
C-8a's `currency.frozen` checks only a channel's own `currency_code`. A channel that inherits its currency from the tenant defaults can have it changed after transacting, by editing the defaults — demonstrated on 2026-09-22: an order in `uk`, `has_transacted` true, then `PATCH /admin/tenant-defaults {currencyCode: EUR}` accepted and `uk` resolving to EUR. Since C-32 the channel is then refused rather than mis-charged, but the rule claims to protect every transacted channel's currency and does not. `updateTenantDefaults` refuses a currency change while any channel inheriting it has transacted, with the same `currency.frozen` violation naming those channels.
*Verification:* the demonstration above, reversed — the same `PATCH` answers `400` naming `uk`; with no transacted inheriting channel it still succeeds, so the rule is not refusing every defaults edit.

**C-38 — Totals and checkout charge the channel's tax rate** *(M, 1.5–2 h; added 2026-09-22)*
A channel's `taxRateBps` — its own, or inherited from the tenant defaults — is validated, stored and shown by admin, and nothing charges it: `TotalsService` and checkout read `pricing.tenant_config.tax_rate_bps`. Demonstrated on 2026-09-22: `trade` set to 0, a cart in `trade` taxed at 875 bps. G-4's shape again, for tax, and no row owned it. The money path takes the rate from the pricing scope, as C-32a did for currency; capabilities then report it under `channel`. Needs a decision recorded in the row when it is built: what a resolved `null` rate — the seam kept for a tax provider — charges.
*Verification:* `trade` at 0 and `uk` at 875, identical carts: taxed differently, and each order's snapshot says so. Today both are taxed at 875.

**C-39 — CI fails when the GraphQL schema or client drifts** *(S, 0.5–1 h; added 2026-09-22)*
R-4 fails CI when the REST client drifts from the api's OpenAPI document. Nothing does the same for the GraphQL half: `schema.graphql` and `generated/graphql.ts` are regenerated by hand (`fetch-schema`, `codegen`) and a stale copy passes. C-18's row assumed this check existed. Add it beside R-4's step, in the job that already runs the api.
*Verification:* a hand-edit to the committed schema fails the step — proved on a real runner, since R-4's local proof once passed a hand-edit that regeneration had silently overwritten.

**C-41 — Every documented command and spec names its channel** *(S, 1–1.5 h; added 2026-09-22)*
The first half of the required-everywhere decision, and the half that breaks nothing: README, RUNBOOK and every other documented `curl` against GraphQL or `/storefront/*`, the api's integration specs and the storefront conformance suite send `x-channel-id` (and the scoped URL for GraphQL). Each works under today's fallback, so this lands before enforcement and C-42 cannot strand a reader mid-tour.
*Verification:* every storefront-surface command extracted from the docs with `sed` and run, each naming a channel; a search for storefront-surface calls without one finds none. Re-run after C-42, where the same search would have found the breakage.

**C-42 — The api requires a channel on the storefront surfaces** *(S, 1–1.5 h; added 2026-09-22)*
A request to GraphQL (any path) or `/storefront/*` that names no channel answers `400`, with a message naming `GET /system/capabilities` as the way to learn the default's key. `/system/capabilities` and `/admin/*` are exempt. Checkout's default-channel fallback goes with it. ADR-0014 §8's expiry, executed.
*Verification:* header-less `GET /graphql`, `GET /api/{tenant}/graphql` and `POST /storefront/carts` answer `400`; today all three answer for `uk`. `GET /system/capabilities` with no channel still answers `200` naming `uk`, so discovery was not refused with the rest. The storefront, the conformance suite and C-41's extracted commands all still pass.

**C-40 — The price filter shows the currency's symbol** *(XS, 0.5–1 h; added 2026-09-22; predates this slice)*
`facet-sidebar.tsx` prints a hardcoded `$` beside the price inputs, so `t-fashion` (GBP) shows `$`. 8c-2 and STOREFRONT.md both claim the storefront stopped hardcoding the currency; this is the one place it did not. Found rendering C-19a's pages in a headless browser. Take the symbol from the `MoneyFormat` the prices already use.
*Verification:* `t-fashion`'s price filter shows `£`, and a tenant switched to JPY shows `¥`. Today both show `$`.

**C-19c — Remove the deprecated capability fields** *(XS, 0.5 h; added 2026-09-22)*
ADR-0014 §7's third step: once the storefront reads `capabilities.channel` (C-19b), drop the tenant-level `currency`, `currencyMinorUnits`, `defaultLocale` and `locales`, in a commit of its own.
*Verification:* the storefront builds and its conformance suite passes with the fields gone; a consumer still selecting one gets a schema error, not a silent default.

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

## Phase H — per-channel price lists (G-4 option B)

Decided 2026-09-22 to follow option A (C-32) as its own phase. Not sized and not split: it needs its own ADR first. What that ADR has to settle, at least: price rows per channel or per currency; what a product with no price in a channel does (C-32's refusal becomes the per-product answer); the denormalised price in the search index, which is one number per product today; and whether promotions are per channel. [CHANNEL-MODEL §7a](design/CHANNEL-MODEL.md) has the starting sketch.

---

## Sequencing notes

Phase A before B: URL scoping is cheaper before channels multiply the URLs, and the admin conventions shape every endpoint in Phase B.

C-15 before C-19: the storefront should not depend on a read-model whose staleness is unclosed.

Phase E is preceded by the auth slice, which is its own ADR (0015) and its own sequence — not items here. It lands before C-20 because the console must not exist without a login.

Phase G touches pricing, not channels plumbing, so it can run any time after Phase B — except C-30, which needs C-10 (channel `PATCH` exists) **and C-32a**, because a per-channel `tax_display` is read on the same money path C-32a makes channel-aware.

**C-32a → C-32b → C-18a → C-18b → C-19a → C-19b → C-19c** (G-4 closed with option A; C-32, C-18 and C-19 split 2026-09-22). C-19d follows C-19b; C-19e follows C-19b, whose discovery it uses. C-42 comes after C-19b, C-19e and C-41 — enforcing before every caller names its channel would break the storefront and the documented commands. C-31 needs C-19b and C-30. C-38 makes a channel's tax rate charged; until it lands, capabilities keep reporting the tenant-level rate that is. Nothing that makes a channel's currency *visible* may land before something makes it *charged or refused*: capabilities advertising EUR for `de` while checkout charges GBP would be a control wired to nothing, and a storefront rendering € around GBP integers is the money bug at display level. C-11, C-25, C-28 and C-33 do not depend on it. Phase H (per-channel price lists) follows C-32 and replaces its refusal with real prices.

**Total ≈ 9–11.5 weeks excluding authentication.**
