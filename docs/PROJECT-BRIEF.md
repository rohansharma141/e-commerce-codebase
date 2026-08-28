# Project brief — e-commerce-codebase

*A self-contained context document. Written to be handed to an assistant that has **no access to the repository** — everything needed to reason about the project is stated inline.*

*Every figure below was checked against the running system on 2026-08-27, at commit `0ff8244` on `main` — which was 60 commits, clean tree, CI green, tagged `v0.1.0`. The commit carrying this correction is necessarily later than the one its figures were taken at; treat the counts as a dated snapshot rather than as live values.*

---

## 1. What this is

A **multi-tenant, headless, API-first commerce platform**, built from scratch (no Medusa, no Shopify, no WooCommerce underneath).

It is a **portfolio piece**, not a commercial product. Its purpose is to demonstrate platform-architecture capability to technical decision-makers — CTOs and architects evaluating whether the author can design and build enterprise-scale systems. A usable small-business product would be a side effect, explicitly not a goal; those buyers are better served by Shopify or WooCommerce, and competing there is not the plan.

That framing drives every trade-off. The guiding principle is **depth over breadth**: one hero feature that genuinely sings, on a clean architectural spine, with a sharp decision record, beats ten half-built modules. The biggest project risk is scope swallowing the demonstration.

**Packaging: two deliverables, sold separately.** The API alone is a complete product. API + storefront is the bundled option. This is an architectural constraint, not marketing — it is enforced in three independent places (§5).

**The hero feature** is faceted search-at-scale over tenant-defined custom attributes: 99,000 seeded products across three tenants, physically isolated per-tenant search indices. Measured on the running stack: **13–22 ms** warm for a filtered, facetted query against a 33,000-document index, and **~320 ms** for the first query after an index write. Both numbers are stated because quoting only the warm one would be the flattering half. If time is ever squeezed, the hero is protected above everything else.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js 22+, TypeScript 5.5 strict, NestJS 10 |
| Storefront | Next.js 14 App Router, React, Tailwind, shadcn/ui |
| Transactional store | PostgreSQL 16 (Drizzle + postgres-js, behind module repositories) |
| Search | OpenSearch 2.15, one index per tenant |
| Cart / sessions | Redis 7 |
| API surfaces | GraphQL (storefront reads) + REST (admin/system), both public |
| Monorepo | pnpm 10.34 + Nx (25 projects) |
| Local stack | Docker Compose — the genuinely runnable artifact |
| Deployment | Kubernetes manifests written and schema-validated in CI; no cluster provisioned |

---

## 3. Repository layout

```
apps/
  api/          the backend monolith (independent deployable)
  storefront/   Next.js storefront (independent deployable)
  seed/         the data seeder
packages/
  modules/<name>/contracts/   PUBLIC interface, DTOs, event types — zero dependencies
  modules/<name>/src/         PRIVATE implementation
  shared/                     event-bus, tenant-context, db, config, security,
                              observability, hooks, opensearch, redis
  api-client/                 generated GraphQL + REST types; the ONLY package
                              the storefront may import from
deploy/k8s/     16 manifests in two bundles: api/ stands alone, storefront/ adds to it
docs/           ARCHITECTURE, DECISIONS, RUNBOOK, STOREFRONT, CAVEATS, BACKLOG,
                LOOM-SCRIPT, HANDOVER, PROJECT-BRIEF (this file), 13 ADRs, plus
                CLAUDE-v2.md — a stale duplicate flagged for deletion (§9)
```

Six domain modules: `catalog`, `search`, `pricing`, `orders`, `cart`, `branding`.

---

## 4. What is built

### The API (build priorities 1–6, complete)

- **Foundation** — monorepo, NestJS, Compose, CI, in-process event bus, tenant plumbing via `AsyncLocalStorage`.
- **Catalog + custom attributes** — tenant-defined, typed, validated at write time. Stored as Postgres JSONB.
- **Multi-tenancy** — `tenant_id` on every row, Postgres row-level security with `FORCE` on a non-superuser role, 12 policies, plus an isolation suite that runs as the non-superuser (running it as superuser would pass vacuously — RLS never engages).
- **Search** — per-tenant OpenSearch indices; attribute definitions drive the mapping, so a new attribute is a new mapped field rather than a migration.
- **Pricing, cart, orders** — integer minor units throughout, best-single promotion stacking, tax on the discounted base, immutable order snapshots at checkout, idempotent checkout keyed on a client-supplied header.
- **Cross-cutting** — helmet, per-tenant rate limiting, typed in-process hook registry, audit log, structured logging.

### The storefront (build priority 7, complete)

Catalog browse, faceted search UI, product detail, cart and checkout, order confirmation, per-tenant theming across three visually distinct tenants, security headers with a per-request CSP nonce, and event-driven cache revalidation.

### Consolidation (build priority 8, complete except one human task)

This was the largest phase and the one that changed the project's character. Its rule: *a claim in a doc, README, or ADR is part of the product; where a doc and the code disagree, the code is the contract and the doc is the bug.*

- **Credibility pass** — the seed writes real catalog rows (the README's RLS proof had been counting an empty table), storefront Dockerfile and Compose service, production CSP, contract-conformance tests, LICENSE.
- **CI that actually verifies** — backing services in CI so the integration suites stopped skipping silently; they had rotted undetected for several commits behind a green pipeline. Pricing domain events; `search.product.indexed` so cache invalidation follows the read model rather than racing it; a transactional webhook outbox with exponential backoff and a bounded dead-letter sweep.
- **API as product** — `Query.capabilities` and `GET /system/capabilities`: the API reports its own currency, minor-unit exponent, tax display, locales and feature map per tenant. The storefront reads them instead of hardcoding `$`, `en-US` and two decimals — proved by switching a tenant to JPY and watching prices re-render unscaled. Per-tenant locale. `branding` extracted into its own module in four reversible steps with `Query.theme` byte-identical throughout.
- **Hardening** — boundary enforcement extended to spec files; dead-letter sweep; a `SEED_VIA_API=1` mode routing a slice through the real HTTP write path so a broken endpoint fails the seed; theme foreground colour; Node 24 support; category-scoped cache invalidation; a genuinely cached storefront read path.
- **Retiring the hand-mirrored types** — the storefront's REST types were 124 hand-written lines kept true only by a conformance test, because the API's DTOs were interfaces and its OpenAPI document described every body as `{}`. Now the DTOs are decorated classes, the document has 17 real schemas, the client types are generated from it, the hand-written file is deleted, and CI fails if the committed copy drifts.
- **Kubernetes manifests** — 16 resources, two bundles, validated against real Kubernetes schemas in strict mode on every push. Deliberately not deployed.

---

## 5. The rules that must not be broken

1. **Never import another module's `src/`** — only its `contracts/`. Enforced by ESLint boundaries and by a `no-restricted-imports` rule catching relative-path evasion. A violation is a build failure.
2. **No cross-module SQL joins, ever.** Each module owns its tables in its own Postgres schema. Modules talk via contracts and events.
3. **Events are network-strict** — plain serializable objects carrying everything the consumer needs; consumers are idempotent because the bus will redeliver.
4. **Multi-tenancy is in every module from line one** — `tenant_id` on every row, RLS as the enforcement backstop rather than app-layer `WHERE` clauses alone.
5. **Modular monolith, not microservices.** Do not add a broker between modules, split services, or build distribution machinery. Extraction is documented, not built.
6. **Storefront ↔ API independence.** The storefront imports only from `packages/api-client` and talks to the API only over its public schema. No in-process calls, no shared state, no DB access. Every capability must remain reachable through the public API alone — if the storefront needs something, extend the API rather than putting logic in the frontend.

Rule 6 is enforced three times over: ESLint boundaries at build time, a Compose graph with no API→storefront edge, and a Kubernetes NetworkPolicy whose storefront egress permits DNS and the API and nothing else.

---

## 6. The verification discipline

This is the project's distinguishing characteristic and the thing most worth understanding before proposing changes. **A green check is not treated as evidence until it has been seen to fail.** Every rule below was paid for by a bug that got through a passing check.

- **A check that can pass vacuously is not a check.** The README's RLS proof returned `0 / 0 / 0` against an empty table and read as a pass. A backfill migration reported "row counts match" as `0 = 0` because RLS hid the source rows from it.
- **Migrations must be verified on a cold database.** The migration ledger means a developer machine never re-runs the failing path. A concurrency race on `CREATE EXTENSION` and a backfill reading a since-dropped column were both invisible locally and fatal on first boot.
- **Execute documented commands; do not re-read them.** A README verification flow turned out to be unrunnable as written. Two commands in the project's own instruction file had never worked at all.
- **A commit message is a claim about the diff.** One commit described a fix that never landed, because the script making the edit aborted before writing.
- **Local success says little about CI or a cold clone.** A warm Docker cache hid a six-minute build; an installed toolchain hid an `engines` mismatch that made a fresh clone impossible on a current Node.
- **Prefer demonstrating over asserting.** "A broken endpoint fails the seed" was proved by breaking the endpoint and showing exit 0 versus exit 1.

Recent examples of the discipline catching something:

| Check | What the negative control revealed |
|---|---|
| Node 24 install | pnpm 10 skips dependency build scripts by default — the install exited 0 having never run the script that used to crash. The allowlist also has to be in `pnpm-workspace.yaml`; in `package.json` it is silently ignored. |
| Category-scoped cache tags | The tags were correct and inert: every storefront route was dynamic and the reads were POSTs, which Next's data cache does not store. No `revalidateTag` call had ever done anything. |
| Generated-types drift check | Passed a hand-edit locally, because regenerating overwrites the edit before the diff runs. Only a run on a real CI runner, with the drift committed, showed it working. |
| Kubernetes manifests | `kubectl` cannot fetch a schema without a cluster and fails identically on valid and invalid input — a check that cannot discriminate. Replaced with containerised `kubeconform`. |

---

## 7. Deliberately not built

Each is a decision with a written rationale, not an omission.

- **Microservices.** A composable API surface does not require a distributed implementation, and the consumer cannot tell. Building the fleet would spend the budget on service mesh and saga plumbing — ops skill, not the architecture skill being demonstrated. Deliberate non-distribution is the senior signal.
- **A message broker between modules.** The in-process bus is correct here. Events are written as if they already cross a network, so extraction stays possible.
- **Back-office admin UI, CMS, MDM, job scheduler portal, omni-channel breadth.** The API has its own admin REST surface.
- **A provisioned Kubernetes cluster.** Manifests are written and validated; nothing is deployed.
- **OpenTelemetry.** Designed, with instrumentation points chosen in an ADR. Not wired.
- **Customer authentication.** Scoped out; needs its own ADR before any work starts.
- **An ICM conformance facade** (ADR-0013). Gated behind the current backlog by its own decision record.

---

## 8. Known gaps, stated honestly

The register holds 19 entries and marks each with a status. Five carry the status **open**:

1. **Cached-read tenant isolation rests on `Vary` and the tenant header.** Every tenant asks the same GraphQL question at a byte-identical URL; the `x-tenant-id` header in Next's cache key and `Vary: x-tenant-id` on every response are what separate them. A regression here would serve one tenant another tenant's catalogue and would look like a working, fast site. Marked *open by nature* — a property to keep checking, not a bug to fix.
2. **Rate limiting is per tenant, not per IP**, so during the trust-by-header window a caller impersonating a tenant can throttle that tenant's real traffic. Per-IP limits belong at the gateway.
3. **Audit log entries do not capture identity beyond a request id.** Follows directly from there being no authentication yet.
4. **The capability feature map describes the deployment, not the tenant.** The currency, locale and tax half is genuinely per-tenant; the feature list is currently a constant. Costs nothing until a capability actually varies per tenant, and the shape was chosen so it can.
5. **The dev revalidate secret is checked into Compose.** Rotation is documented and was verified by performing it.

Two larger gaps are *not* in that count, because the register classifies them differently — but they matter more than most of the five above, so do not read the taxonomy as a ranking:

- **No customer auth** (*scoped out*). Order reads go through an admin endpoint, so any browser holding an order UUID can fetch that order within its tenant. Fine for a demo; not acceptable for production. This is the largest functional gap, and it needs its own ADR before any code.
- **Tenant id is the trust boundary** (*by design*). The API trusts the `x-tenant-id` header; real authentication is the gateway's job (ADR-0007).

The remaining twelve entries are marked *by design*, *resolved* or *closed* — among them: the integration suites drop the catalog, pricing and orders schemas, so a green suite followed by an empty storefront is both working as designed.

---

## 9. Current state and what remains

- **`main` = `3a0eaf9`**, 59 commits, clean, CI green, `v0.1.0` tagged.
- **CI** runs three jobs on every push: lint/build/test with real Postgres, Redis and OpenSearch containers plus Kubernetes manifest validation; storefront↔API contract conformance against a seeded API; and an install-and-build on Node 24 with the side-effects cache disabled.
- **Backlog: 29 of 30 rows done.** The only open row is recording a 2–3 minute walkthrough video — a human task.
- Suggested-but-unbuilt from the most recent audit: delete a stale duplicate of the instruction file (`docs/CLAUDE-v2.md`, a 90-line copy contradicting the live 121-line one); write a production deployment guide, which the new manifests now give something concrete to explain; and mark a historical findings table in the backlog as closed so it stops reading as open work.

---

## 10. In flight: the channels slice

Branch `channels`, designed and not yet built. It is the first slice aimed at **commerce depth** rather than consolidation — the deliberate turn toward what Intershop and commercetools provide, with an operator-facing back office as the artefact that surfaces it.

A tenant today is a single market: one currency, one locale, one tax configuration, one implicit storefront. The slice makes a tenant a business selling into several — sales channels with their own currency, locales, country, timezone and tax, inheriting from tenant defaults — plus an admin console to configure them, an API that reports each channel's resolved configuration, and authentication as a prerequisite because a console without a login is not defensible.

Roughly 9–11.5 weeks excluding auth. Three decision gates are closed; nothing blocks the first item.

Read [docs/design/CHANNELS-OVERVIEW.md](design/CHANNELS-OVERVIEW.md) first — it carries the functionality, the full decision register with reasons, the honest limits, and the non-goals. [ADR-0014](adr/0014-channel-as-sales-channel.md) holds the arguments, [CHANNEL-MODEL](design/CHANNEL-MODEL.md) the mechanics, [BACKLOG-channels](BACKLOG-channels.md) the sequence.

Two limits worth carrying into any discussion of it: a channel holds **one** currency, so this is not multi-currency; and locales drive **formatting, not translation**, because the catalog has no locale dimension.

---

## 11. Open questions worth thinking about

These are genuinely undecided, and are the most useful things to discuss.

1. **Is the differentiation thin enough to matter?** The honest competitive position is "open-source and self-hostable like WooCommerce, architecturally capable and natively multi-tenant like commercetools." Medusa is very close to that square — Node/TS, modular monolith, headless, Postgres — and its only real gap is that it is multi-*store* rather than multi-*tenant*, a gap its ecosystem is drifting to close. For a portfolio piece this thinness is acceptable, because the goal is demonstration. Should it stay acceptable, or should the project narrow to a specific vertical or operator workflow on top of multi-tenancy?
2. **What is the strongest next demonstration?** The hero is search-at-scale on custom attributes. Candidates for a second: customer auth done properly with an ADR; a real gateway in front of the tenant-header trust boundary; or making the extraction path concrete by actually pulling one module out behind an HTTP boundary and measuring what breaks.
3. **How much does the missing walkthrough cost?** Everything else in the demonstration is complete. The recording is the artifact a non-technical stakeholder actually consumes, and it does not exist.
4. **Is the caveats register an asset or a liability in front of a buyer?** It is unusually candid — five open gaps, each with impact and fix. The bet is that visible honesty reads as seniority to a CTO. That bet has never been tested on a real audience.
5. **Does the verification discipline read as rigour or as overhead?** It is the most distinctive thing about how this codebase was built, and it is currently visible only in commit messages, a section of the instruction file, and the caveats register. It may deserve to be a first-class part of the pitch rather than an implementation detail.

---

## 12. How to help with this project

- Default to the choice that keeps modules decoupled, the API self-sufficient, and the hero feature strong.
- If a request implies the storefront knowing something the API does not expose, say so — the fix is to extend the API, never to smuggle logic into the frontend.
- If a request implies building something from §7, flag it against scope before proceeding rather than quietly building it.
- Suggestions that add distribution machinery (brokers, service splits, a provisioned cluster) run against a deliberate, documented decision. Argue with the decision explicitly if you disagree; do not route around it.
- When proposing a change, propose how it would be *checked* — and specifically, what the check would print if the change did nothing. That question is the project's house style and has caught more defects than any other single habit.
- Work is sized so that stopping is always cheap: one backlog item, one commit, one stated verification. Anything that needs the word "and" between deliverables is two items.
