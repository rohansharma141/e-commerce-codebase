# Build sequence

The granular work queue. [CLAUDE.md](../CLAUDE.md) holds the coarse build priority; this holds the individual increments it decomposes into.

**Sizing rule: one item, one commit, one verification.** If describing an item needs the word "and" between deliverables, it is two items. Sizes are XS (< 30 min), S (30–60 min), M (60–120 min). Nothing larger exists here on purpose — anything that would be gets split before it is started, not while it is being built.

**Why this file exists.** Step 8b shipped as a single commit spanning CI containers, three event changes, an outbox and two incidental bug fixes. Every part was justified and verified, but there was no point at which the work could be reviewed or redirected. Items are small so that stopping is always cheap.

Each row states what "done" means as a single check. If the check can't be written down, the item isn't understood well enough to start.

**Status: 24 of 30 rows done** (plus 8c-1 and 8c-2, which shipped before this file existed). What is left: one human task (8d-5, the walkthrough recording) and the five items in the R series.

**A note on how these got verified.** Several of these items were "done" by a check that could not have failed — a row count of `0 = 0`, an RLS proof against an empty table, a commit message describing an edit that never wrote. The lessons are recorded under *Verification discipline* in [CLAUDE.md](../CLAUDE.md) and are worth reading before ticking anything here.

---

## P0 — unblock everything downstream

CI has never run on a GitHub runner. Until it has, every "verified" claim rests on one laptop.

| id | item | done when | size |
|---|---|---|---|
| P0-1 | ✅ Push `main` and watch the first CI run end to end | both jobs report a result | XS |
| P0-2 | ✅ Fix what the run revealed — concurrent migrations racing on a fresh database, not the predicted memory/timing issues. Migration runner now takes an advisory lock | CI green on `main` | S |

---

## 8c-3 — extract `modules/branding/`

**Note on ordering.** An earlier version of this plan had the branding module created first and "still reading `pricing.tenant_config.theme`". That step cannot ship: it would have one module read another module's table, which is the no-cross-module-SQL rule. Storage moves first, so no intermediate state violates a non-negotiable.

| id | item | done when | size |
|---|---|---|---|
| 8c-3a | ✅ Move `StorefrontTheme` + `DEFAULT_THEME` into `packages/modules/branding/contracts/`; pricing re-exports them so nothing breaks yet | build green, zero behaviour change | S |
| 8c-3b | ✅ `branding` Postgres schema, `branding.theme` table, migration backfilling from the pricing column | row count per tenant matches the pricing column | S |
| 8c-3c | ✅ Branding module: repository, resolver, app wiring. `Query.theme` reads the new table; seed writes it | `Query.theme` output byte-identical for all three tenants | M |
| 8c-3d | ✅ Drop `pricing.tenant_config.theme` and the pricing-side theme code | no theme references left in pricing; themes still render | S |

## 8c follow-ups — surfaced by the capability work

| id | item | done when | size |
|---|---|---|---|
| 8c-5 | ✅ `locale` column on tenant config; admin endpoint accepts and returns it | PUT then GET round-trips a locale | S |
| 8c-6 | ✅ `capabilities.defaultLocale` reports the per-tenant value. **No storefront change** — it already asks the api | a de-DE tenant renders `1.000,00` | XS |
| 8c-7 | ✅ `GET /system/capabilities` REST mirror, for consumers that don't speak GraphQL | curl returns the same data as the GraphQL query | S |

---

## 8d — ship the story

8d-2 and 8d-3 depend on CI being green. 8d-6 comes before 8d-5 deliberately: a cold-clone run tends to shake out README bugs, and finding them on camera is worse than finding them now.

| id | item | done when | size |
|---|---|---|---|
| 8d-1 | ✅ GitHub repo description + topics | visible on the repo page | XS |
| 8d-2 | ✅ CI badge in the README | badge renders green | XS |
| 8d-3 | ✅ `v0.1.0` tag | tag pushed | XS |
| 8d-4 | ✅ Screenshots — storefront browse with latency, per-tenant theming, RLS killshot — embedded in the README | images render in the README | S |
| 8d-5 | Record the Loom from [LOOM-SCRIPT.md](LOOM-SCRIPT.md) | video exists and is linked | M — human task |
| 8d-6 | ✅ Cold clone-and-run the README's 60-second tour, writing down every deviation | findings recorded | S |
| 8d-7 | ✅ Fix what 8d-6 found — the seven findings below | the tour runs clean from a cold clone | M |

### What the cold run found

Run on 2026-08-26: fresh `git clone` from GitHub into an empty directory, dev stack torn down with `down -v` first so nothing was warm except Docker's layer cache. Findings in the order a reader hits them.

| # | finding | severity |
|---|---|---|
| 1 | **`pnpm install` fails outright on Node 24.** `engines` says `>=22`, which admits 24; the pinned pnpm 9.12.0 crashes in nx's postinstall with `readStream must be readable`. `.nvmrc` says `22` but nothing enforces it, and the README never mentions a Node version. Everything downstream of this step is unreachable. | blocking |
| 2 | **`pnpm seed` therefore fails** with `'nx' is not recognized` — the install left `node_modules` incomplete. The tour cannot be completed on the documented steps alone. | blocking |
| 3 | **Claim 2, the RLS killshot, returns `0 / 0 / 0`** without a seed — unbound, bound, and superuser counts are all zero, so it demonstrates nothing. This is the same empty-table problem 8a fixed at the seed level, reachable again by any reader whose seed didn't run. | high — it is the headline proof |
| 4 | **Claim 3 is unrunnable as written.** It uses `$PROMO_ID` and `$ORDER_ID` and says "after the curl flow above produced an order" — no such flow exists anywhere in the README. Nothing shows how to create a cart, check out, or list promotions. | high |
| 5 | **`docker compose up --build` took 6m03s**, against a documented "~30s once images are pulled" — and that was *with* a warm Docker layer cache. The estimate predates the storefront image added in 8a, so the tour now builds two images. | medium |
| 6 | **The README's foreground `docker compose up --build` blocks the terminal**, then the next line tells the reader to run `pnpm install`. Needs `-d` or an explicit "second terminal" instruction. | medium |
| 7 | **The storefront section is stale.** It says to run `pnpm nx serve storefront`, but compose has started a storefront container on port 3001 since 8a — so the instruction is redundant, would collide on the port, and fails on Node 24 anyway. | medium |

What did work, unchanged: `git clone` (2.4s), the whole Docker stack coming up healthy, and every endpoint in the README's table — `/health`, `/ready`, `/docs`, `/graphql`, and the storefront on `t-fashion.localhost:3001` — all returning 200.

---

## Hardening — standalone, pick up opportunistically

Each is independent of the others and of the sequence above. All correspond to an open entry in [CAVEATS.md](CAVEATS.md).

| id | item | done when | size |
|---|---|---|---|
| H-1 | ✅ ESLint `no-restricted-imports` banning `../../*/src/*`, plus fixing the one existing violation in the orders integration spec | lint fails on a deliberately added violation | S |
| H-2 | ✅ Dead-letter sweep that re-queues exhausted outbox rows | an exhausted row is retried after the sweep | S |
| H-3a | ✅ Category-scoped cache tags — vocabulary, and the api naming which category listings a change affects (including the one a moved product just left) | a product edit invalidates only its category's tags; an event without categories still falls back to the broad tag | M |
| H-3b | ✅ Make the storefront's reads cacheable — reads moved to `GET /graphql`, and the api stopped answering `cache-control: no-store`, which Next honours | two identical requests for a category page produce one `search.completed` in the api log, not two | M |
| H-3c | ✅ H-3's original check, runnable once H-3b lands | editing one category leaves other category caches warm | XS |
| H-4 | ✅ `SEED_VIA_API=1` mode routing a small slice through the real HTTP write path | a broken `POST /admin/products` fails the seed | S |
| H-5 | ✅ Deployment-guide note on rotating the checked-in dev revalidate secret | documented | XS |
| H-7 | ✅ Theme has no page foreground colour, so a dark tenant renders unreadable body text — add `pageFgHsl` (found while screenshotting for 8d-4) | t-electronics is legible | S |
| H-6 | ✅ Support Node 24 by moving off pnpm 9 — the crash is the whole major line, not just 9.12. pnpm 10.34.5, `onlyBuiltDependencies` in `pnpm-workspace.yaml`, `engines` widened to `>=22`, and a CI job that installs and builds on Node 24 with the side-effects cache off | `pnpm install` succeeds on Node 24 | M |

---

## R — retire the hand-mirrored REST types

The one genuinely large item in the backlog, split so no step is a rewrite. Today `packages/api-client/src/rest.ts` is 124 hand-written lines kept honest only by the contract-conformance test.

**Decided before starting, because it is the kind of thing that gets decided badly at 11pm:** the decorated classes live in each module's `src/`, implementing the matching `contracts/` interface. They do **not** go in `contracts/`. Those packages have zero dependencies today, and `@ApiProperty` would put `@nestjs/swagger` inside the public contract — the thing a consumer imports would then require our web framework. Implementing the interface means the class cannot drift from the contract without a type error, which is the property that actually matters. [capabilities.module.ts](../apps/api/src/capabilities.module.ts) is the existing example.

**Why R-1/R-2 each cover the controller too:** decorating the DTOs creates schemas that nothing references. Until the controller declares `@ApiBody` / `@ApiResponse({ type })`, the operation still documents nothing and the generator still has nothing to emit. One deliverable, one check — "Swagger shows real schemas" is only true when both halves are done.

| id | item | done when | size |
|---|---|---|---|
| R-1 | Cart: DTO classes with `@ApiProperty`, and the controller's six operations declaring their request and response types | `/docs-json` shows cart request/response schemas, not `{}` | S |
| R-2 | Orders: the same, for the orders controller | `/docs-json` shows real order schemas | S |
| R-3a | `openapi-typescript` wired as an `api-client` target alongside `codegen`, output committed. Nothing imports it yet | running the target twice produces no diff | S |
| R-3b | Storefront imports the generated types; hand-written `rest.ts` deleted | `pnpm nx build storefront` green with `rest.ts` gone | M |
| R-4 | CI fails when the generated output drifts from what is committed | a hand-edit to the generated file fails CI | XS |

R-1 and R-2 are independent and can go in either order; both must land before R-3a, which needs real schemas to generate from. R-4 hangs off the conformance job, which already boots the api — that is where a regenerate-and-diff step gets a live `/docs-json` for free.

---

## Not in the sequence

- **ADR-0013's ICM conformance facade** — gated behind this backlog by its own decision record.
- **Customer auth** — scoped out; needs its own ADR before any work starts.
- Everything in CAVEATS.md marked *by design*: the in-process bus, undeployed Kubernetes manifests, unshipped OpenTelemetry, tenant-id-as-trust, and microservices.
