# @platform/storefront

Multi-tenant Next.js storefront. Separate deployable from the api; talks to the api over its public GraphQL + REST surface only.

## Run

```bash
# In one terminal — backend
docker compose up --build
pnpm seed

# In another — storefront
pnpm nx serve storefront
```

Then open one of:

- http://t-fashion.localhost:3001/
- http://t-electronics.localhost:3001/
- http://t-books.localhost:3001/

Modern browsers resolve `*.localhost` natively. No `/etc/hosts` edits.

## Where everything lives

| | Where | Why |
|---|---|---|
| Routes | `src/app/` | App Router. Home + `/c/[category]` + `/p/[id]` + `/cart` + `/orders/[id]`. |
| Tenant from Host | `src/middleware.ts` | Subdomain → `x-tenant-id` request header. |
| Tenant in code | `src/lib/tenant.ts` | `getTenantId()` for Server Components and actions. |
| Read path (GraphQL) | `src/lib/urql.ts` | `@urql/next/rsc` client. Attaches the tenant header per request. |
| Write path (REST) | `src/lib/api-rest.ts` | `server-only` fetch wrapper. Used by server actions. |
| Cart cookie | `src/lib/cart.ts` | `cart_id_<tenantId>` HTTP cookie. |
| Mutations | `src/app/cart/actions.ts` | `'use server'` — addToCart, setLineQty, applyCoupon, removeCoupon, checkout. |
| Browse | `src/app/page.tsx` | Server-rendered grid + facets via `Query.search`. |
| PDP | `src/app/p/[id]/page.tsx` | Server-rendered detail via `Query.product`. |
| Cart shell + view | `src/app/cart/` | RSC reads, client view mutates via actions. |
| Order confirmation | `src/app/orders/[id]/page.tsx` | Server-rendered post-checkout. |
| Security headers | `next.config.mjs` | CSP / X-Frame-Options / Referrer-Policy. |

## Boundary rule

This app imports ONLY from `@platform/api-client`. Never from `@platform/modules/*` or `@platform/shared/*`. ESLint fails the build on violation.

Why: the storefront is a sellable artifact separate from the api. Every capability must remain reachable via the public api alone. See [ADR-0010](../../docs/adr/0010-storefront-sellable-separately.md).

## Architecture deep-dive

See [docs/STOREFRONT.md](../../docs/STOREFRONT.md) for the longer treatment — rendering split, security model, what's deferred, and a request-flow diagram.

ADRs covering load-bearing storefront decisions:
- [0010](../../docs/adr/0010-storefront-sellable-separately.md) — sells separately
- [0011](../../docs/adr/0011-server-actions-not-cors.md) — server actions, not CORS
- [0012](../../docs/adr/0012-subdomain-tenant-resolution.md) — subdomain tenant resolution

## Generated client

After a schema change in the api:

```bash
pnpm nx run api-client:fetch-schema   # api must be running
pnpm codegen                           # rebuild typed documents
```

Generated files at `packages/api-client/src/generated/` are committed so CI builds without needing the api up.

## What's not built yet

- Per-tenant themes (7f). CSS vars are wired; only one set of values today.
- ISR + event-driven revalidation (7e). All pages are dynamic SSR today.
- Production-grade nonce-based CSP (so inline scripts work without `'unsafe-inline'`).
- shadcn/ui adoption. Primitives are plain Tailwind for now.
- Customer auth + storefront-scoped order reads.
