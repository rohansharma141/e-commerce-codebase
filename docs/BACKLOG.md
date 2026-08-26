# Build sequence

The granular work queue. [CLAUDE.md](../CLAUDE.md) holds the coarse build priority; this holds the individual increments it decomposes into.

**Sizing rule: one item, one commit, one verification.** If describing an item needs the word "and" between deliverables, it is two items. Sizes are XS (< 30 min), S (30–60 min), M (60–120 min). Nothing larger exists here on purpose — anything that would be gets split before it is started, not while it is being built.

**Why this file exists.** Step 8b shipped as a single commit spanning CI containers, three event changes, an outbox and two incidental bug fixes. Every part was justified and verified, but there was no point at which the work could be reviewed or redirected. Items are small so that stopping is always cheap.

Each row states what "done" means as a single check. If the check can't be written down, the item isn't understood well enough to start.

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
| 8c-6 | `capabilities.defaultLocale` reports the per-tenant value. **No storefront change** — it already asks the api | a de-DE tenant renders `1.000,00` | XS |
| 8c-7 | `GET /system/capabilities` REST mirror, for consumers that don't speak GraphQL | curl returns the same data as the GraphQL query | S |

---

## 8d — ship the story

8d-2 and 8d-3 depend on CI being green. 8d-6 comes before 8d-5 deliberately: a cold-clone run tends to shake out README bugs, and finding them on camera is worse than finding them now.

| id | item | done when | size |
|---|---|---|---|
| 8d-1 | GitHub repo description + topics | visible on the repo page | XS |
| 8d-2 | ✅ CI badge in the README | badge renders green | XS |
| 8d-3 | ✅ `v0.1.0` tag | tag pushed | XS |
| 8d-4 | Screenshots — search latency, storefront browse, RLS killshot — embedded in the README | images render in the README | S |
| 8d-5 | Record the Loom from [LOOM-SCRIPT.md](LOOM-SCRIPT.md) | video exists and is linked | M — human task |
| 8d-6 | Cold clone-and-run the README's 60-second tour, writing down every deviation | findings recorded | S |
| 8d-7 | Fix what 8d-6 found | the tour runs clean from a cold clone | S–M, unknown |

---

## Hardening — standalone, pick up opportunistically

Each is independent of the others and of the sequence above. All correspond to an open entry in [CAVEATS.md](CAVEATS.md).

| id | item | done when | size |
|---|---|---|---|
| H-1 | ESLint `no-restricted-imports` banning `../../*/src/*`, plus fixing the one existing violation in the orders integration spec | lint fails on a deliberately added violation | S |
| H-2 | Dead-letter sweep that re-queues exhausted outbox rows | an exhausted row is retried after the sweep | S |
| H-3 | Category-scoped cache tags (`browse:<tenant>:category:<slug>`) | editing one category leaves other category caches warm | M |
| H-4 | `SEED_VIA_API=1` mode routing a small slice through the real HTTP write path | a broken `POST /admin/products` fails the seed | S |
| H-5 | Deployment-guide note on rotating the checked-in dev revalidate secret | documented | XS |

---

## R — retire the hand-mirrored REST types

The one genuinely large item in the backlog, split so no step is a rewrite. Today `packages/api-client/src/rest.ts` is maintained by hand and kept honest only by the contract-conformance test.

| id | item | done when | size |
|---|---|---|---|
| R-1 | Cart DTOs promoted to classes with `@ApiProperty` | Swagger shows real cart schemas, not `{}` | M |
| R-2 | Orders DTOs promoted to classes with `@ApiProperty` | Swagger shows real order schemas | S |
| R-3 | Wire `openapi-typescript`; `rest.ts` becomes generated | storefront compiles against generated types | M |
| R-4 | CI fails when the generator output drifts from the committed types | a hand-edit to the generated file fails CI | XS |

---

## Not in the sequence

- **ADR-0013's ICM conformance facade** — gated behind this backlog by its own decision record.
- **Customer auth** — scoped out; needs its own ADR before any work starts.
- Everything in CAVEATS.md marked *by design*: the in-process bus, undeployed Kubernetes manifests, unshipped OpenTelemetry, tenant-id-as-trust, and microservices.
