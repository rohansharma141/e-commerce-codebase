# Project brief — e-commerce-codebase

*A self-contained context document. Written to be handed to an assistant that has **no access to the repository** — everything needed to reason about the project is stated inline. Current as of 2026-08-20, commit `38f2287`.*

---

## 1. What this is

A **multi-tenant, headless, API-first commerce platform**, built from scratch (no Medusa, no Shopify, no WooCommerce underneath).

It is a **portfolio piece**, not a commercial product. Its purpose is to demonstrate platform-architecture capability to technical decision-makers — CTOs and architects evaluating whether the author can design and build enterprise-scale systems. A usable small-business product would be a side effect, explicitly not a goal; those buyers are better served by Shopify or WooCommerce, and competing there is not the plan.

That framing drives every trade-off. The guiding principle is **depth over breadth**: one hero feature that genuinely sings, on a clean architectural spine, with a sharp decision record, beats ten half-built modules. The biggest project risk is scope swallowing the demonstration.

**Packaging: two deliverables, sold separately.** The API alone is a complete product. API + storefront is the bundled option. This is an architectural constraint, not marketing — it is enforced in code by lint rules (details in §5).

**The hero feature** is faceted search-at-scale over tenant-defined custom attributes: ~99,000 seeded products across three tenants, sub-20ms faceted queries, physically isolated per-tenant search indices. If time is ever squeezed, the hero is protected above everything else.

---

## 2. Tech stack (brief)

**Backend — `apps/api`**
- Node.js 22, TypeScript 5.5 (strict mode, no `any` without a justifying comment)
- NestJS 10 — REST for admin/system, GraphQL (Apollo Server 4) for the storefront read edge
- Drizzle ORM over `postgres-js`, kept behind per-module repositories so the ORM is swappable
- zod for env validation, pino for structured logging, helmet + `@nestjs/throttler` for security, `@nestjs/swagger` for REST docs

**Storefront — `apps/storefront`**
- Next.js 14.2 (App Router), React 18, TypeScript
- Tailwind CSS + shadcn-style primitives (hand-rolled on `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`)
- urql + GraphQL Codegen (client-preset) for typed operations; server-side reads go through a thin `fetch` wrapper so Next.js cache tags can be attached per query

**Data stores — chosen per bounded context, never "two DBs to show off"**
- PostgreSQL 16 — orders, money, tenancy, pricing, audit (ACID + row-level security)
- OpenSearch 2.15 — faceted search and browse (one index per tenant)
- Redis 7 — carts and sessions (tenant-prefixed keys)
- Catalog custom attributes live in Postgres JSONB

**Tooling**
- pnpm 9.12 + Nx 20 monorepo (23 projects), Jest, ESLint with Nx module-boundary enforcement, GitHub Actions CI (lint + test + build; `nx affected` on PRs), Docker Compose for the local stack

---

## 3. Repository layout

```
apps/
  api/                  the backend deployable (NestJS)
  storefront/           the Next.js deployable (ships separately)
  seed/                 CLI that bulk-loads 99k products + prices + promotions

packages/
  api-client/           generated GraphQL types + hand-mirrored REST types.
                        The ONLY package the storefront may import from.
  shared/               config, database, event-bus, hooks, observability,
                        opensearch, redis, security, tenant-context
                        (backend-only; no domain logic)
  modules/
    catalog/            products + tenant-defined typed attributes
    search/             OpenSearch indexer + GraphQL Query.search  ← hero
    pricing/            prices, tax, promotions, totals, tenant theme
    cart/               Redis-backed cart
    orders/             checkout, snapshot integrity, idempotency

docs/                   ARCHITECTURE, DECISIONS, CAVEATS, STOREFRONT,
                        RUNBOOK, HANDOVER, LOOM-SCRIPT, adr/0001-0012
docker/                 Postgres init (creates the non-superuser app role)
```

Every domain module is split into **`contracts/` (public)** and **`src/` (private)**. A module may import another module's `contracts/`, never its `src/`.

---

## 4. What is already built

All seven steps of the planned build priority are complete, committed, and pushed. 17 commits on `main`.

### Steps 1–6 — the API (complete)

| Area | What exists |
|---|---|
| **Foundation** | pnpm + Nx monorepo, NestJS app, Docker Compose stack, GitHub Actions CI, in-process event bus, tenant plumbing via AsyncLocalStorage |
| **Catalog** | Products plus tenant-defined typed attribute definitions (string/number/boolean/date/enum), validated at write time against that tenant's own schema |
| **Multi-tenancy** | `tenant_id` on every row; Postgres row-level security with `FORCE` on `catalog.*`, `pricing.*`, `orders.*`, `audit.*`; the app's `platform` role is deliberately non-superuser and non-`BYPASSRLS` so RLS actually bites; `app.tenant_id` set per request on a reserved pooled connection |
| **Search (hero)** | One OpenSearch index per tenant (`products-<tenant>`); a client handle that is bound to a single index by construction, so there is no cross-tenant API surface at all; GraphQL `Query.search` with faceted aggregation over custom attributes, text match, sort (relevance/price/name), autocomplete via `match_phrase_prefix`, true total counts, and per-query latency reporting. Filtering is generic rather than bespoke: one `AttributeFilter` type with `eq` / `in` / `gte` / `lte` covers any tenant-defined attribute, which is how price-range and in-stock filters work without the API knowing what "price" or "in stock" mean |
| **Pricing** | Prices, per-tenant tax config, promotion engine with best-single stacking, all money as integer cents with banker's rounding |
| **Cart** | Redis-backed, tenant-prefixed keys (`t:<tenant>:cart:<id>`), snapshots SKU and name at add-time |
| **Orders** | Transactional checkout — `Idempotency-Key` support, conditional promotion consumption under concurrency, full price/promo/tax snapshot written into the order so historical records never drift when live config changes |
| **Cross-cutting** | Helmet, per-tenant rate limiting, an audit log of every successful mutation under `/admin/*` and `/storefront/checkout`, request-id propagation end to end, `/health` + `/ready` (probes all three stores), Swagger UI at `/docs`, a Postman collection, a typed hook registry for extension points |

**Seeded demo data:** three tenants — `t-fashion`, `t-electronics`, `t-books` — roughly 33,000 products each, written to both Postgres (canonical) and the tenant's OpenSearch index (queryable projection), along with six attribute definitions, 33,000 prices, and sample promotions per tenant. Measured search latency from the seed CLI's own benchmark: p50 ≈ 5ms, p95 ≈ 12ms, p99 ≈ 26ms over 200 random queries per tenant.

### Step 7 — the storefront (complete, plus extras)

A Next.js 14 App Router app on port 3001, deployable separately from the API.

- **Tenant resolution from the hostname.** `t-fashion.localhost:3001` in dev, `t-fashion.example.com` in prod. Middleware parses the subdomain and injects `x-tenant-id` into the request headers; bare `localhost` redirects to the default dev tenant; reserved subdomains like `www` are rejected. The storefront code never hardcodes a tenant name.
- **Catalog browse** — home and category pages with a faceted sidebar driven by the hero search, free-text search bar, sort, price-range form, in-stock toggle, grid/list view switching, and server-rendered pagination. All state lives in the URL and every control is a link or a plain form, so browsing and filtering work with client-side JavaScript disabled.
- **Rendering split** — browse, category, and product pages are server-rendered through the Next.js data cache with tags plus a one-hour fallback, so they behave as ISR and are rebuilt by events rather than on a timer. Cart and order pages are explicitly dynamic: they're personal and have no SEO value.
- **Autocomplete** — a debounced suggestions endpoint backed by the search module's prefix-matching mode.
- **Product detail** — custom attributes, price, stock state, breadcrumbs, a "more like this" rail pinned on category or brand, and add-to-cart.
- **Cart and checkout** — cart cookie per tenant, quantity edits, coupon apply/remove, live totals, checkout, order confirmation page.
- **Event-driven ISR revalidation** — catalog mutations emit domain events; the API dispatches a webhook to the storefront's `/api/revalidate`; the storefront maps the event onto Next.js cache tags (`browse:<tenant>`, `product:<tenant>:<id>`, `theme:<tenant>`) and rebuilds the affected pages within seconds. The payload is deliberately *event-shaped*, not tag-shaped — the API never learns the storefront's cache topology.
- **Per-tenant theming** — brand name, colors, and typography load from the API per request via a `Query.theme` resolver and apply as CSS variables. One codebase, no per-tenant forks.
- **Security headers** — `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff` and a restrictive Permissions-Policy from the Next config, plus a per-request CSP issued by middleware. The CSP carries a fresh nonce per request, which Next stamps onto the inline scripts it emits for the RSC payload and hydration; a build-time header can't express that, which is why the two are deliberately split across the two files.
- **Tests** — a URL-contract unit suite, and a conformance suite that issues every operation the storefront uses against a live API and checks the responses against the shapes it relies on, including exact key sets for the hand-mirrored REST types. The lint boundary proves nothing was imported across the line; this proves the public surface actually delivers what the storefront reads.
- **Documentation** — a storefront architecture doc, three additional ADRs, and a recording script for a 2–3 minute walkthrough.

---

## 5. The rules that must not be broken

These are enforced, not aspirational. Any proposed change should be checked against them.

1. **Never import another module's `src/`** — only its `contracts/`. ESLint's module-boundary rule fails the build on violation.
2. **No cross-module SQL joins, ever.** Each module owns its own Postgres schema. Modules communicate through contracts and events.
3. **Events are network-strict** — plain serializable objects carrying everything the consumer needs, cloned on dispatch, consumers idempotent because the bus may redeliver. They are written as if they already cross a network, because one day they will.
4. **Multi-tenancy in every module from line one.** `tenant_id` on every row, RLS as the enforcement backstop rather than app-layer `WHERE` clauses, tenant resolved once at the edge and threaded via AsyncLocalStorage.
5. **Modular monolith, not microservices.** Do not add a message broker between modules, split services, or build distribution machinery. The in-process event bus is the correct answer at this scale. Extraction is *documented* (which module splits first, and why), not built.
6. **Storefront ↔ API independence.** The storefront imports only from `packages/api-client` — never a domain module, never a shared backend lib. It talks to the API exclusively over the public GraphQL/REST surface: no in-process calls, no shared memory, no direct database access. **Every capability must remain reachable through the public API alone.** If something is tempting to "just put in the frontend for now," the correct fix is to extend the API.

The reasoning behind each of these is recorded in `docs/DECISIONS.md` and twelve ADRs, so decisions can be interrogated individually rather than taken on faith.

---

## 6. Deliberately not built

Documented as "designed, not built" where relevant — each has a written rationale:

- **Microservices.** A composable API surface does not require a distributed implementation; the consumer cannot tell the difference. Building a real fleet would burn the budget on service mesh, saga orchestration, and eventual-consistency debugging — which demonstrates ops skill, not the architecture skill being showcased. The senior signal here is deliberate non-distribution plus a credible extraction plan.
- **Kubernetes deployment.** Manifests written, cluster not provisioned. Docker Compose is the genuinely-runnable artifact.
- **OpenTelemetry export.** Trace topology and instrumentation plan documented; wiring is mechanical once there's a collector to point at.
- **A conformance facade for a foreign REST contract.** Recorded in ADR 0013. A third deployable (`apps/icm-compat`) would translate Intershop's Commerce Management REST contract onto this platform's GraphQL edge, so that a commerce frontend this project did not write could boot against the API unmodified. The purpose is validation, not compatibility: it would turn "every capability is reachable through the public API alone" from an assertion into something a foreign consumer can falsify, since a lint rule only proves nobody imported across the boundary, not that the surface is sufficient. No claim of vendor interoperability follows from it, and no third-party source would enter the repository. Deliberately gated behind the gap list in §7.
- **Real authentication.** `x-tenant-id` is trusted at face value today. In production a JWT-validating gateway sits in front, extracts the tenant from validated claims, and injects the header — the API itself stays unchanged. Direct internet exposure is demo-only.
- **Back-office admin UI, CMS, MDM, job scheduler portal, omni-channel breadth.** The API has its own admin REST surface; a UI on top of it adds no architectural signal.
- **Inventory, shipping, refunds, customer accounts.** Breadth, not depth.

---

## 7. Known gaps and current work items

Honest list. Nothing here is hidden in the repo — most is already tracked in `docs/CAVEATS.md`.

Work is organised as step 8, "make every claim the repo makes hold". Sub-step 8a is complete.

**Closed in 8a**
- The seed now writes `catalog.products` and `catalog.attribute_definitions` alongside the search index, so the README's RLS proof compares 0 unbound against 33,000 bound instead of an empty table against itself.
- The storefront has a Dockerfile and a compose service, making the two-deployables claim real. `docker compose up api` still runs the platform without it.
- Production CSP issues a per-request nonce from middleware, so a production build hydrates. This was pulled forward from 8b because shipping a container that renders but never hydrates would have replaced one false claim with another.
- The storefront has tests: a URL-contract unit suite and a conformance suite that drives every operation the storefront issues against a live API, asserting exact key sets for the hand-mirrored REST types.
- Docs reconciled with what actually shipped; `LICENSE` added.

**What the pass uncovered — none of it visible before the work started**
- **The storefront build was broken.** `@graphql-typed-document-node/core` wasn't declared in the storefront's `package.json`, so under pnpm's isolated node_modules the type failed to resolve, `TypedDocumentNode` degraded, and *every* `graphqlQuery` call site silently inferred `unknown`. The "fully typed generated client" was not typed at all, and `next build` had been failing since the autocomplete commit. Declaring the dependency fixed the build and restored inference everywhere.
- **Two load-bearing integration suites had been dead for several commits.** `catalog.integration.spec.ts` and `checkout.integration.spec.ts` stopped compiling when their services gained a `HookRegistry` constructor argument, then needed the ALS tenant context the services had begun requiring. The tests proving RLS isolation, snapshot integrity, promotion races and idempotency were not running.
- **CI never runs the integration tests at all** — the workflow declares no service containers, so those suites skip and green CI means "compiles and unit tests pass". That is why the two failures above went unnoticed, and it is now the top open item.
- **The module suites destroy seeded data**, dropping the catalog, pricing and orders schemas. Running the full suite against the demo database silently empties it.
- The ESLint module boundary doesn't catch deep relative imports (`../../cart/src/...`), so the "never import another module's `src/`" rule holds for the shape people usually write rather than universally.

**Open — architectural, with known fix paths**
- **CI runs no integration tests.** The workflow has no Postgres/Redis/OpenSearch services, so every integration suite skips and the platform's load-bearing guarantees go unverified on every push. Adding the service containers is the single highest-value fix outstanding. (8b)
- **Revalidation webhooks are fire-and-forget.** A failed POST is logged, not retried; the affected page stays stale until the one-hour fallback. The fix is a persistent outbox with a retry worker — which is also what unlocks moving to a real broker later. (8b)
- **Pricing emits no domain events.** Price and promotion changes don't reach the revalidation pipeline, and the product page reads its price from the denormalized search document, so a price edit isn't visible on the storefront until a reindex. Mirroring the catalog module's event pattern fixes both. (8b)
- **The API cannot describe itself.** There is no endpoint advertising supported locales, currency, tax display behaviour, or per-tenant enabled features. Our own storefront hardcodes what it needs, which only works because one author wrote both sides; any consumer we didn't write has to be configured out of band. For a headless product sold standalone this undercuts the "complete on its own" claim more than any missing feature. (8c)
- **Theme storage is on the pricing module's tenant config table** — a deliberate shortcut that muddles module ownership. Extracting a small branding module is the clean fix and wouldn't change the public resolver shape. (8c)
- **No customer auth.** Order confirmation reads through the admin endpoint, so anyone holding an order UUID can fetch it within that tenant. Fine for a demo, not for production; the fix is customer JWTs plus a storefront-scoped order endpoint. Scoped out, needs its own decision record.
- **Rate limiting keys on tenant id, not IP**, so during the trust-by-header window a caller impersonating a tenant can throttle that tenant's real traffic. Per-IP limits belong at the gateway.
- **The seed bypasses the HTTP write path.** It writes to Postgres and OpenSearch directly, so a broken `POST /admin/products` would still leave a fully-populated demo, and attribute validation never runs against seeded data. Deliberate: 99,000 HTTP round-trips would turn a 15-second seed into a multi-minute one.

**Presentation polish (8d)**
- No release tag, no CI badge, no screenshots. A walkthrough script is written but nothing has been recorded. The README's cold-clone quickstart has never been run from scratch. GitHub repo description and topics are empty.

---

## 8. How to run it

```bash
pnpm install
docker compose up --build      # Postgres, Redis, OpenSearch, api
pnpm seed                      # ~10s: 99k products, prices, promotions, 3 tenants
pnpm nx serve storefront       # separate terminal, port 3001
```

- API at `http://localhost:3000` — `/health`, `/ready`, `/docs` (Swagger), `/graphql`
- Storefront at `http://t-fashion.localhost:3001/` (also `t-electronics`, `t-books`). Modern browsers resolve `*.localhost` natively; no hosts-file edits needed.
- **Every tenant-scoped API call needs an `x-tenant-id` header.** Missing it is a deliberate 400 — the middleware is fail-closed.
- All money in the API is integer cents. `$199.99` is `19999`. Never floats.

Useful commands: `pnpm nx run-many -t lint` (includes boundary enforcement), `pnpm nx run-many -t test` (integration tests skip unless the `TEST_*_URL` env vars point at the running stack), `pnpm nx build api`, `pnpm nx build storefront`, `pnpm codegen` (regenerates the typed API client from the live schema).

---

## 9. How to help with this project

- Default to the choice that keeps modules decoupled, the API self-sufficient, and the hero feature strong.
- If a request implies the storefront knowing something the API doesn't expose, say so — the fix is to extend the API, never to smuggle logic into the frontend.
- If a request implies building something from §6, flag it against scope before proceeding rather than quietly building it.
- Suggestions that add distribution machinery (brokers, service splits, K8s deployment) run against a deliberate, documented decision. Argue with the decision explicitly if you disagree; don't route around it.
