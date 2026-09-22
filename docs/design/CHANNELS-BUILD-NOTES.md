# Channels slice — build notes: what we learned, and what went wrong

The companion to [CHANNELS-OVERVIEW](CHANNELS-OVERVIEW.md) (what the slice delivers and why) and [BACKLOG-channels](../BACKLOG-channels.md) (the sequence, with each row's verification record). This file holds what the other two do not: the **technical traps** this codebase contains, the **mistakes made while building**, and the **process lessons** those mistakes paid for.

It exists because these facts otherwise live in commit messages and one session's context, and both are easy to lose. Where an entry names a commit, the commit message has the full account.

Written 2026-09-19; updated 2026-09-22 for C-11, C-33, C-32a and C-32b.

---

## 1. Technical traps in this codebase

Every entry below produced a symptom whose cause was elsewhere. Most share one shape, named in §4: **the operation succeeded while doing nothing.**

### Database and persistence

**Drizzle's `db.transaction()` escapes the tenant binding.** The request-scoped Drizzle client is built on a Proxy of the request's reserved connection. Single statements route through it; `db.transaction()` resolves to the *parent* client's `begin()` and takes a **fresh** pool connection with no `app.tenant_id`. RLS then hides every row: reads return empty and `UPDATE … WHERE` affects zero rows **without an error**. Demonstrated with a probe printing `OUTSIDE: probe-tenant  INSIDE: null`. Use **`withTenantTransaction`** from `@platform/shared/database`, never `db.transaction()`. Found twice — once in checkout (fixed locally), once in channel default-promotion, where it caused 17 of 19 initial integration failures. *(`b279598`)*

**Drizzle's `.set()` silently drops keys it does not recognise.** It wants schema property names (`taxRateBps`), not SQL column names (`tax_rate_bps`). Handed the latter, the UPDATE still succeeds, still bumps `version`, still returns a row — and changes nothing. The channels repository's `put()` helper is typed to the row's keys so a column name is now a compile error. *(`b279598`)*

**Every module's migrations must be copied into the api image by hand.** `apps/api/Dockerfile` has one `COPY` line per module, and there is no glob that preserves the per-module directory names. Forget one and the container dies at boot with *"<module> migrations directory not found"* — invisible to `nx serve` and to every test, which read migrations from the source tree. The Dockerfile now carries a warning. *(`b279598`)*

**Module migration order is not guaranteed.** Modules migrate in whatever order Nest initialises them. A migration that reads another schema must guard on `to_regclass('<schema>.<table>') IS NOT NULL`, following branding's `0001`. Orders' `0003` does, and the guard was **proven** by applying orders' migrations to a throwaway database that had no channels schema at all — rather than by observing one lucky ordering. *(`24f8f11`)* Observed 2026-09-22 in the boot log: audit, catalog, channels, pricing, branding, orders — so on a cold database channels migrates before pricing exists.

**A migration is subject to RLS, because FORCE applies to the owner.** Migrations run as `platform`, which owns every table and is NOSUPERUSER NOBYPASSRLS, and FORCE ROW LEVEL SECURITY exists precisely to make policies apply to the owner. A backfill with no tenant bound therefore reads no rows and updates none, and nothing errors. Orders' `0003` claimed the opposite in its comment and was a no-op for three weeks. Lift RLS explicitly inside the migration's transaction: `NO FORCE` on the module's own tables, restored before the block ends; for another module's table, its `app.system_worker` clause set transaction-local, or `NO FORCE` if its policy has none (branding's `0001`). Then verify the backfill against rows that exist **before** it runs — a cold database has none, which is how this hid. *(C-11, C-33)*

**A raw postgres-js connection may return `timestamptz` as a string.** The Drizzle path hides this; raw `sql` in the reconciler threw `toISOString is not a function` on its first run. Coerce with `new Date(v).toISOString()`, which is correct for either. *(`3028b92`)*

**A timer has no tenant.** Background work (the outbox worker, the channel reconciler) runs with no `app.tenant_id`, so RLS feeds it zero rows and it reports success having read nothing — the `0 = 0` shape this project shipped once already. Bind `app.system_worker` transaction-locally (`set_config(…, true)`), and **assert a non-zero count**. The reconciler also *refuses* a zero-row result rather than applying it, because it cannot tell an RLS-blinded read from an empty database. *(`3028b92`)*

### The event bus

**The in-process bus is asynchronous.** `publish()` schedules each handler with `queueMicrotask` and returns immediately. Three consequences, all learned by running rather than reading:

- A publisher resolves **before** its handlers' side effects commit. A test that reads a handler's effect straight after the publishing call reads too early — C-17's first run saw `has_transacted = false` while the consumer's own log line said it had set it. Tests of handler effects must poll (see the `eventually` helper in `checkout.integration.spec.ts`).
- A handler must **not** use the request's ambient, tenant-bound connection: it may already be released. Bind the tenant **from the event** in the handler's own transaction, as `WebhookOutboxRepository.enqueue` and `ChannelTransactedConsumer` do.
- Cross-module effects are **eventually consistent**, and handler failures are isolated from the publisher by design. A dropped event is not retried. Design every consumer to be idempotent *and* self-healing where it can be (C-17's conditional UPDATE re-attempts on every later order).

### HTTP and contracts

**`JSON.stringify(new Set())` is `{}`.** A `Set` in a domain object must be converted at the HTTP boundary, or the client receives an empty object where it expected a list. `ResolvedChannel.inherited` is converted in the channels controller; the test asserts on the *serialised* form, because the bug exists only after `stringify`. *(`7cd0136`)*

**An ETag must come from the same read as the body.** Fetching the body and the version in two queries lets a concurrent write land between them, producing an ETag that describes a different version than the payload — a client doing everything right is then refused forever or overwrites an edit it never saw. *(`dc3e5a8`)*

**Two `Symbol()` calls with the same description are different symbols.** A DI token is defined **once**, in `contracts/`, and re-exported — a second definition silently produces a key nothing is bound to. *(`24f8f11`)*

**The boundary rule decides where DI tokens live.** `type:src` may depend only on `scope:shared` and `type:contracts`, so a token another module injects must be in the provider's `contracts/`, and the providing module must be `@Global` (as Pricing, Cart and now Channels are) because the consumer cannot list it in `imports`. *(`24f8f11`)*

**The storefront pins the exact key set of `Order` and `Cart`.** `apps/storefront/src/contract.integration.spec.ts` fails on any added field, deliberately — a regenerate would otherwise absorb it silently. Any change to a response shape owes a run of **this** suite, which lives in the storefront project, not the api. *(`a5b031b`)*

### Tooling and environment

**Nx caches `test` on file inputs only; environment variables are not in the key.** `pnpm nx test api` followed by `TEST_API_URL=… pnpm nx test api` replays the cached *skipped* run as a pass. Always pass `--skipNxCache` to live suites.

**The api throttles at 200 requests per minute per tenant.** `admin-conventions.integration.spec.ts` costs ~80 requests. Two live suites in one minute exhaust it, and a 429 read as an ordinary response makes healthy endpoints look broken — this misdiagnosed twice before the specs learned to throw a named 429 error. Space live suites about a minute apart.

**A failed `docker compose build` leaves the old container serving,** and `/ready` still answers 200. Check a behavioural marker that only the new code produces before trusting a rebuild.

**The destructive suites drop more than they used to.** `channels.integration.spec.ts` drops the `channels` schema; `checkout.integration.spec.ts` now drops `orders`, `pricing` **and** `channels`. After either, re-run `pnpm seed` and recreate at least two orders through real checkout — `admin-conventions` pages through `/admin/orders` and its `beforeAll` refuses to run on fewer than two.

**Mutating an applied migration trips the checksum guard before the mutation is tested.** The runner refuses a changed file, so a mutation run against a database that already applied the original fails in `beforeAll` — "suite failed to run", which proves nothing. Rebuild the throwaway database before each mutation run, as C-11's and C-33's were.

**Git Bash on this machine breaks heredocs with heavy quoting,** and the Bash tool rejects commands containing control characters. Write multi-line content with the Write tool and commit with `git commit -F <file>`.

**Backslash escapes in a tool call can arrive as the real control character.** The layer between an agent and the shell or file decodes one level of backslash escaping. So a doubled backslash meant to survive into a Python string reaches Python single, and Python turns it into a real byte. This produced a NUL byte three times: once in source, and twice in this file while documenting the first. A fourth time, while reviewing these notes, a backslash-n inside a regular expression arrived as a real line break and broke the checking script mid-string. Git then treats the file as binary and `grep` stops matching it, so the damage is quiet. Construct control bytes in code, with `bytes([0])` or `chr(92)`, rather than typing escapes, and before committing a new or heavily edited file check it: `python -c "import sys; print(open(sys.argv[1],'rb').read().count(bytes([0])))" <file>` must print `0`.

---

## 2. Mistakes made while building the slice

Recorded because the project's standing rule is to say plainly what failed, including self-inflicted failures, and because most of these are repeatable by the next person.

| # | What went wrong | How it was caught | What changed |
|---|---|---|---|
| 1 | **C-5, C-7, C-10, C-11a and C-2b were written without a database**, at the user's direction after the trade-off was raised. They compiled and linted; three contained silent-success bugs (the Dockerfile omission, the transaction escaping RLS, `PATCH` changing nothing). | The integration spec written alongside them, run against a cold database. It had been written to **skip** rather than pass, and the commit was labelled UNVERIFIED everywhere (`a722adf`). | Fixed in `b279598`. Unverified work is labelled in the commit, the backlog row and a spec banner until it runs. |
| 2 | **I wrote a torn ETag** — body and version from two separate queries — in C-10. | Reading the handler while closing C-9. | One read returns both, with a mutation proving the test would catch a regression (`dc3e5a8`). |
| 3 | **I overwrote an existing contract file** (`channels/contracts/src/events.ts`) assuming it was a stub, silently dropping an event and a payload field. | Reading the diff before committing. | Restored; only the genuine addition kept. Read a file before replacing it. |
| 4 | **I typed literal NUL bytes into a source file** as a map-key separator, making it binary to `grep` and defeating two attempted fixes. | A byte dump. | Written as escape sequences (a backslash, then u0000). **I then repeated this mistake twice while writing these notes:** the escape I typed here was decoded into a real NUL byte, and a checker run before committing caught both. Written out in words now, so no tool can decode it. |
| 5 | **Two mutation tests did not compile**, and "suite failed to run" briefly looked like the suite catching the mutation. | Reading the error rather than the count. | Redone with mutations that build. A mutation that fails to compile demonstrates nothing. |
| 6 | **Two golden values in C-29 were computed half-up**, not half-even. | The tests. | Kept as labelled `.5`-tie sentinels — the only inputs that distinguish the two rounding policies. |
| 7 | **ADR-0015 argued from a false premise** — that the manifests expose the api through a wildcard Ingress. The Ingress is the storefront's; the api has none. | Checking `deploy/k8s/` before committing, instead of trusting recollection. | The argument was restated accurately and weaker, and the opposing alternative was rewritten to be fair. |
| 8 | **Tests appended outside their `describe` closure**, missing tsconfig path mappings, a test hard-coding `version: 1` (it got a correct `409`), and a test depending on the previous test's state. | Running them. | Each fixed before commit; the `409` note is left in the test, because it is the feature working. |
| 9 | **C-16a changed the `Order` shape and I ran only the api's suites.** The storefront conformance suite, which pins `Order`'s keys, was broken on the branch. | Its next run: `+ "channel"`. | Fixed in `a5b031b`. C-16b widened `Cart`'s keys in the same commit that added the field. |
| 10 | **The C-9 concurrency spec leaked five draft channels per run** into the demo tenant. | A later channel listing for an unrelated check. | `afterAll` archives them, proved by counting (10 → 15 total, 5 → 5 non-archived) rather than inferring (`9617852`). |
| 11 | **The seed held the same fact twice, and the copies had drifted**: pricing seeded every tenant as USD while `t-fashion`'s channel said GBP, and taxed `t-electronics` at 725 bps against its channel's 625. | C-16a's live check printed `currency: USD` next to `"key": "uk"`. | The pricing seed derives both from the channel fixtures (`24f8f11`). |
| 12 | **I wrote a false claim into a doc comment** — that the bus handler "happens to run within the request". It does not; the bus is asynchronous. | C-17's first test run. | Comment and test corrected (`37d1a00`); §1 above records the bus's real behaviour. |
| 13 | **A code comment asserted documentation that did not exist** — `ChannelReadModel` said "CAVEATS records that" before it did. | C-26. | The entry was written (`5df2c98`). |
| 14 | **The largest planning miss: nothing charges a channel's currency, and I attributed that work to C-18 in six places.** C-18 is capabilities-only; no row owned it. The design drafts never assigned it and my reconciliation of them did not notice. | C-17's live check printed `channel = de \| currency = GBP` on one line. | Gate **G-4** opened, **C-32** added, CAVEATS corrected, the six references fixed (`05ff688`). Detail in BACKLOG-channels. |
| 15 | **Two stated verifications could not fail**, and I nearly ran them as written: C-16b's "currency follows the cart's channel" (currency is still tenant-level), and C-4's "guard fails if the channel header stops being sent" (the storefront does not send it yet). | Asking what each would print if the feature were absent. | C-16b tests the binding instead; the currency half moved to C-32. C-4's client guard moved to C-19. Both recorded. |
| 16 | **On resuming, I proposed `docker compose down -v` against the stack the user had just started.** The tool call was rejected. | The user. | Resumed with a non-destructive `up -d`. Wiping someone's running environment needs their explicit consent, even mid-task. |
| 17 | **After being asked to keep Docker down, my own `docker ps` woke the WSL backend.** | Memory measurement. | `wsl --shutdown` again. Even read-only Docker commands start the VM on Windows. |
| 18 | **I wrote a false claim into orders' `0003` (C-16a) — that the migration "runs as the table owner, so it is not subject to the FORCE RLS policy" — and its backfill never updated a row.** FORCE means the opposite. The checks I ran could not reach it: a cold database has no orders to backfill. | Reading it while planning C-11, three weeks later. Then proven: a spec (THE BUG) and the real image, 0 of 4 orders attributed. | `0004` does the backfill with RLS lifted explicitly (C-33). `0003`'s comment is immutable and stays wrong; `0004`'s header is the correction. |
| 19 | **C-16a's fix for drifted seed fixtures derived currency and tax, but not locale.** `t-fashion`'s pricing locale stayed `en-US` against its channels' `en-GB`, and capabilities reports the pricing copy. | C-11's live run printed `GBP` next to `en-US` for `t-fashion`. | Recorded under C-11; C-18 removes the pricing copy. Not patched in the seed, which would add a third place holding the value. |
| 20 | **`findDefault`'s error message claimed C-11's guarantee before C-11 existed** — the same shape as #13. | Planning C-11. | The message says what is true; the tenant-onboarding gap is in CAVEATS. |
| 21 | **I proposed the C-11 plan with a "leak" mutation its design could not observe.** A rolled-back transaction reverts a session-level setting too. | Designing the spec. | C-11 lifts RLS with `NO FORCE` only, so it has no setting to leak; the leak test moved to C-33, whose spec commits. |
| 22 | **The C-17 freeze test I wrote placed an order in a EUR channel against a USD price list** — G-4's bug, running inside a test, unnoticed because the test asserted the freeze and not the charge. | C-32a made it fail. | It now edits the currency away and back before ordering, which proves the same thing without selling in a mismatched currency. |
| 23 | **C-32b's first build mounted the guard on `storefront/(.*)`, which matches nothing** under Express's path-to-regexp 0.1.13. The unit tests could not see it — they call the middleware directly — and `POST /storefront/carts` still refused `de`, because C-32a's cart check returns the same body. | The live check's add-item and coupon probes, which only the middleware can refuse, answered `404`. | `storefront/*`, a comment on why, and a RUNBOOK trap. |
| 24 | **My first server-side latency comparison timed Apollo's CSRF `400`s**, not reads: the probe sent no preflight header, and both builds "measured" 1.0 ms. A comparison that could not have differed. | The build-identity marker returned `400` where `200` was expected. | The probe now refuses to time anything but `200`s; the real figures are 4.5 ms against 4.0 ms. |
| 25 | **The currency freeze I designed in C-8a checks only a channel's own `currency_code`.** An inherited currency can change after transacting, through the tenant defaults. | Wondering, during C-32b's live check, why editing the defaults' currency had been allowed; then demonstrating it with an order in `uk`. | C-37. CAVEATS corrected meanwhile. |
| 26 | **I told the user C-32a was committed as a hash I had not seen** — 3c7d4fb, which is no commit at all; it was `48d784c`. The command's output had been cut before the hash. | The next `git log`, a minute later. | Corrected to the user at once. A hash is quoted from output, never recalled. |

### Earlier in the same session, on `main`

These predate the channels branch and are recorded where they were fixed; listed here so the pattern is visible in one place.

- A RUNBOOK outbox query reported exhausted webhooks as delivered, because `markExhausted` also stamps `delivered_at`.
- pnpm 10 silently ignores the `pnpm` field in `package.json`; `onlyBuiltDependencies` there skips every build script while the install still exits 0. Separately, pnpm self-managed *down* to 9.12.0 to obey `packageManager`, invalidating a test.
- Storefront cache tags were inert for months: every read was a POST, and Next's data cache stores GET only. `unstable_cache` did not help. A counting method using `docker compose logs --since` (one-second granularity) then made the *working* cache look broken.
- R-4's drift check passed a hand-edit locally, because regeneration overwrote the edit before the diff; it had to be proved on a real runner.
- A probe route 404'd because Next treats `__`-prefixed folders as private.
- A PROJECT-BRIEF mapping was stated rather than checked, and was wrong.
- On design gates, I recommended simplifying `tax_display` to read-only; the user overrode that ("build the depth properly"), which produced Phase G. I also offered a scope extension (tenant-prefixed admin routes) reflexively, after arguing against it.

---

## 3. Collaboration notes

The working agreement for this slice, as practised. It is the user's, recorded so it survives a context reset.

- **Build the depth properly rather than trimming controls.** When a control needs engine work, scope the engine work — that is why `tax_display` became Phase G. A control wired to nothing is worse than no control.
- **One backlog item, one commit, one stated verification.** Every verification states what it prints if the change did nothing. A check that cannot fail is not a check, and is rewritten or deferred *with a note*, never quietly run.
- **Tell the user plainly what failed, including self-inflicted failures.** This file is that rule applied.
- **Docker as needed** (revised 2026-09-22; until then it was "never start Docker unaided, never `down -v` without asking"). Start this project's services only when a step needs them — Postgres alone for database specs, the full stack only for live checks — and stop them afterwards. Quit Docker Desktop only when no other project's containers are running; other projects on this machine use it. `down -v` is allowed when a step needs a cold database. Point destructive specs at a throwaway `platform_test` database rather than the demo one. On this Windows machine `wsl --shutdown` reclaims the memory (measured 3.96 GB → 0; OpenSearch is ~89% of it), but it stops every project's containers.
- **Decisions that change what the slice delivers are the user's** — raise them as gates with options and a recommendation, and keep building what does not depend on them.
- **CI does not run on the `channels` branch.** Every "verified" claim on it is local-only until a PR into `main` exists or the workflow's trigger is widened. The user has declined a PR for now.

---

## 4. Process lessons

Each is general, and each was paid for above.

1. **The dominant failure here is silent success.** A transaction that sees no rows, an update that sets no columns, a container that cannot find its migrations, a replica that reloads nothing. None raises an error. Assert that the **new value is present**, never merely that no error was thrown.
2. **Pair every "rejects" test with an "allows" test.** A validator that refuses everything passes a suite of only-rejections.
3. **Assert that a rejected write wrote nothing.** A service that throws *after* persisting passes a test that checks only the throw.
4. **Keep a test that passes against the bug, on purpose, next to the one that proves the fix** — `THE BUG` in `scoped-graphql.integration.spec.ts`, `THE GAP` in the reconciler spec. Without the contrast the fix proves little.
5. **Prove a guard by exercising the path it guards**, not by observing a run where it was not needed (the `to_regclass` migration guard).
6. **Count; do not infer.** The probe-cleanup fix was believed only after a before/after count.
7. **Re-read from storage, not from the object you were handed.** The order-snapshot test re-reads the order, because the in-memory copy could hold a stale value and pass regardless.
8. **Look at live payloads.** Two of the three most consequential findings (the drifted fixtures, the uncharged channel currency) surfaced only because two contradictory values appeared in the same HTTP response.
9. **A cross-deployable contract change owes both sides' suites.**
10. **Put verified logic behind a port when its persistence is unverified.** `ChannelStore` let the invariant guards be proven against a fake while the SQL underneath had never run, so a SQL bug could not be mistaken for a rule bug.
11. **Two copies of one fact drift.** Derive the second from the first.
12. **Check documents mechanically, not by rereading them.** A small script run before committing these notes — every relative link resolves, every anchor exists, every cited commit hash is real, no NUL bytes or replacement characters — found three links in `BACKLOG-channels.md` that had been broken since the design drafts were committed and had survived many readings, plus the NUL above. It is not in CI; it would be a cheap addition.
13. **Verify an upgrade path by building the old state; a cold boot cannot reach it.** A backfill has nothing to do on an empty database. C-11 and C-33 were checked by making the demo database look as `main` left it and booting three images in turn: `500` with 0 of 4 orders attributed, then `201` with 0 of 4, then `201` with 4 of 4.
14. **A spec on a shared database must not commit what other suites can see.** C-11's backfill acts on every channel-less tenant, so its spec rolls back. C-33's touches only rows no other suite creates, so it may commit — and has to, to see a setting outlive its transaction.
15. **A registered route is not a guarded route.** Prove a guard on each surface it claims, with a request only the guard can refuse — a route another layer also refuses will pass for the wrong reason.
16. **Check what a measurement measured.** Confirm the status of the requests being timed before comparing their timings, and compare server-side figures, not a client behind a port proxy.
