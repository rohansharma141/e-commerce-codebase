# CLAUDE.md

Enterprise commerce platform — a multi-tenant, headless, API-first system built **from scratch** as a portfolio piece demonstrating platform-architecture capability. Depth over breadth: a thin slice built well beats broad and shallow.

For the full reasoning behind every decision here, see @docs/DECISIONS.md (load when a "why" question comes up; do not assume it's in context).

## Stack
- Node.js + TypeScript, **NestJS** backend
- PostgreSQL (orders, tenancy, money), OpenSearch (search), Redis (cart/sessions)
- GraphQL (read/storefront edge) + REST (admin/system)
- pnpm + Nx monorepo; Docker; Prisma or Drizzle (behind module repositories)

## Project layout
- `apps/` — deployables (`api` is the monolith)
- `packages/modules/<name>/` — domain modules; each has **`contracts/` (public)** and **`src/` (private)**
- `packages/shared/` — event-bus, tenant-context, db, config (no domain logic)

## Non-negotiable rules
- **Never import another module's `src/`** — only its `contracts/`. Enforced by ESLint boundaries; a violation is a build failure, not a style nit.
- **No cross-module SQL joins, ever.** Modules talk via contracts and events. Each module owns its tables in its **own Postgres schema** (`catalog`, `orders`, …).
- **Events are network-strict**: plain serializable objects, carry everything the consumer needs, consumers are idempotent (the bus will redeliver). Write them as if they already cross a network — they will, when a module is extracted later.
- **Multi-tenancy is in every module from line one.** `tenant_id` on every row; Postgres **row-level security** as the enforcement backstop (not just app-layer WHERE clauses); tenant resolved once at the gateway, threaded via AsyncLocalStorage. Every new table and query must be tenant-scoped.
- **Modular monolith, not microservices.** Do NOT add a message broker between modules, split services, or build distribution machinery. The in-process event bus is correct. Extraction is documented, not built. (See DECISIONS D-01, D-08.)

## Data store choice (per bounded context — never "two DBs to show off")
- Money / orders / tenancy → PostgreSQL (ACID + RLS)
- Catalog + custom attributes → Postgres JSONB (or document store)
- Search / faceted browse → OpenSearch
- Cart / sessions → Redis

## Build priority (do not get ahead of this order)
1. Foundation: monorepo, NestJS, Docker compose, CI, event bus, tenant plumbing
2. Catalog + custom attributes (tenant-defined, typed, validated)
3. Multi-tenancy hardening: RLS policies + isolation tests (two tenants must NOT see each other)
4. **Search hero feature** — faceted, custom-attribute-aware, seeded at volume, with latency metrics. This is the centerpiece; protect it above all else.
5. Pricing + throwaway cart, then orders (transactional core)
6. Cross-cutting: security, customizability hooks, observability, docs

## Out of scope — do not build (document as "designed, not built" if relevant)
Storefront/back-office UI, CMS, MDM, job scheduler, omni-channel breadth, actual microservices deployment, Kubernetes cluster (write manifests, don't deploy).

## Conventions
- TypeScript strict mode. No `any` without a comment justifying it.
- Every module: contracts define the interface + DTOs + event types before src is written.
- Tests required for: tenant isolation, pricing math, event idempotency. These are the demonstration — they aren't optional.
- DB access stays behind a module repository so the ORM/store is swappable.
- Commit messages: imperative mood, scope prefix (`catalog:`, `pricing:`, `search:`).

## Commands
- `pnpm install` — install
- `pnpm dev` — run the api app locally
- `docker compose up` — full local stack (Postgres, Redis, OpenSearch, app)
- `pnpm nx test <module>` — test one module
- `pnpm nx lint` — lint incl. boundary enforcement
- `pnpm nx run-many -t build` — build all

## When unsure
Prefer the choice that keeps modules decoupled and the hero feature strong. If a request implies building something in the out-of-scope list, flag it against scope before proceeding. The architecture doc and DECISIONS.md are the source of truth for "why".
