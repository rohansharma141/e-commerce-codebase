# Storefront architecture

The storefront is a Next.js 14 (App Router) app at `apps/storefront/`. It ships as a separate deployable from the api and follows three load-bearing rules:

1. **Imports from `@platform/api-client` only.** ESLint-enforced. See [ADR-0010](adr/0010-storefront-sellable-separately.md).
2. **Mutations go through server actions, never browser→api directly.** No CORS on the api. See [ADR-0011](adr/0011-server-actions-not-cors.md).
3. **Tenant resolves from the Host subdomain.** Same regex shape as the api's tenant validator. See [ADR-0012](adr/0012-subdomain-tenant-resolution.md).

Everything below is a longer treatment of how those rules are realised in code.

## At a glance

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser                                                                 │
│    t-fashion.localhost:3001                                              │
│    cookies: cart_id_t-fashion=<uuid>                                     │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │  GET /, /p/<id>, /cart, /orders/<id>          
                           │  POST <page-url> (server actions)             
                           ▼                                               
┌──────────────────────────────────────────────────────────────────────────┐
│  apps/storefront  (Next.js 14 App Router)                                │
│                                                                          │
│   src/middleware.ts  ── Host → x-tenant-id ──► request headers           │
│        │                                                                 │
│        ▼                                                                 │
│   ┌───────── App Router pages ─────────┐    ┌──── Server actions ────┐   │
│   │  RSC (server components)           │    │  'use server' in       │   │
│   │  ├─ /          home (browse)       │    │  src/app/cart/actions  │   │
│   │  ├─ /c/[cat]   category browse     │    │  ├─ addToCart          │   │
│   │  ├─ /p/[id]    product detail      │    │  ├─ setLineQty         │   │
│   │  ├─ /cart      cart shell          │    │  ├─ applyCoupon        │   │
│   │  └─ /orders/[id] confirmation      │    │  ├─ removeCoupon       │   │
│   │                                    │    │  └─ checkout           │   │
│   │  Client components (use client)    │    │                        │   │
│   │  ├─ /cart cart-view (qty, totals)  │    │  Server-only modules:  │   │
│   │  └─ /p/[id] add-to-cart-button     │    │  ├─ lib/api-rest.ts    │   │
│   └──┬─────────────────────────────────┘    │  └─ lib/cart.ts        │   │
│      │                                      └──┬─────────────────────┘   │
│      │ urql (server-side via @urql/next/rsc)   │ fetch + x-tenant-id     │
└──────┼─────────────────────────────────────────┼─────────────────────────┘
       │                                         │
       ▼                                         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  apps/api  (NestJS — REST + GraphQL)                                     │
│    Query.search, Query.product (GraphQL)                                 │
│    /storefront/carts/*, /storefront/checkout (REST)                      │
│    /admin/orders/:id (REST, used for confirmation today)                 │
└──────────────────────────────────────────────────────────────────────────┘
```

## Rendering split

| Route | Render mode | Why |
|---|---|---|
| `/`, `/c/[category]` | Dynamic SSR (`force-dynamic`) | Search params drive the query — caching would mean stale URL state. SSG/ISR is planned in step 7e via on-demand revalidation. |
| `/p/[id]` | Dynamic SSR (`force-dynamic`) | Same — would move to ISR with event-driven revalidation in 7e. |
| `/cart` | Dynamic SSR | Personal, no SEO. Cookie-driven. |
| `/orders/[id]` | Dynamic SSR | Personal, no SEO. |
| (no static pages today) | — | All catalog routes are search-driven; once 7e lands the category and product pages get ISR + revalidate tags. |

## Tenant resolution

`middleware.ts` runs on every request the matcher allows:

```ts
const TENANT_RE = /^([a-zA-Z0-9._-]+)\.(localhost|.+)(?::\d+)?$/;
```

Behaviour:

| Host | Outcome |
|---|---|
| `t-fashion.localhost:3001` | `x-tenant-id: t-fashion` injected into request headers |
| `t-electronics.localhost:3001` | `x-tenant-id: t-electronics` |
| `localhost:3001` | 302 → `t-fashion.localhost:3001` (default dev tenant) |
| `www.example.com` | 400 (reserved subdomain) |
| `example.com` (prod, no subdomain) | 400 |

Server Components and server actions read the header via `headers()` from `next/headers`. The tenant id flows from middleware → `getTenantId()` (`src/lib/tenant.ts`) → urql `fetchOptions` and REST wrapper `apiFetch`. The api header is set automatically; the storefront code never spells "t-fashion" anywhere outside of the dev default fallback.

## The two data paths

### Read path (GraphQL via urql RSC)

`src/lib/urql.ts` registers a per-request urql client via `@urql/next/rsc`. Server Components call `getClient().query(SomeDocument, vars)`. The fetchOptions closure reads `getTenantId()` and attaches `x-tenant-id`. No hydration round-trip, no client-side waterfall.

Operations live in `packages/api-client/src/operations/*.graphql` and are compiled into typed `DocumentNode`s with `CatalogSearchQuery` / `ProductDetailQuery` result types.

### Write path (REST via server actions)

Every mutation is a server action. The browser POSTs to the current page URL with a Next-Action header; Next.js routes it to the action function. Inside the action:

1. `getTenantId()` reads the middleware-injected header.
2. `ensureCartId(tenantId)` reads the `cart_id_<tenantId>` cookie or creates a cart via `POST /storefront/carts`.
3. `apiFetch` makes the api call with `x-tenant-id` attached.
4. `revalidatePath('/cart')` and `revalidatePath('/', 'layout')` mark caches dirty so the next render reflects the mutation.
5. For checkout: clear the cookie, `redirect` to `/orders/<id>`.

The api-client's `rest.ts` provides the typed shapes (`Cart`, `Order`, `ComputedTotals`, etc.). See [ADR-0010](adr/0010-storefront-sellable-separately.md) for why those are hand-mirrored today and the path to auto-generation.

## Security baseline

Set in `apps/storefront/next.config.mjs` via the `headers()` config:

| Header | Value |
|---|---|
| Content-Security-Policy | Strict. `script-src 'self'` in prod (today this breaks hydration — needs nonce-based CSP; tracked). Dev adds `'unsafe-inline' 'unsafe-eval'` for HMR + RSC streaming. |
| X-Frame-Options | `DENY` |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `no-referrer` |
| Permissions-Policy | Camera, mic, geolocation, FLoC all blocked |

The api adds its own helmet baseline. Both layers carry independent CSP/headers so a misconfiguration on one doesn't silently weaken the other.

**Outstanding:** production CSP needs nonce-based inline-script support before hydration works on a prod build. Documented in the pre-demo checklist memory.

## Mobile-first

- Layout uses CSS Grid with mobile-first breakpoints: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` for the product grid; `lg:grid-cols-[260px_1fr]` for catalog-with-facets so the sidebar drops below the grid under `lg`.
- All interactive controls (qty +/−, add to cart, checkout) are full-width on mobile and keyboard-accessible.
- shadcn/ui is in the planning list but not yet integrated — primitives today are plain Tailwind. Adding shadcn is non-breaking and a follow-up.

## What's NOT in the storefront yet

Tracked in the build priority 7 sub-steps:

- **7e — ISR + event-driven revalidation.** Catalog edits in the back office should rebuild the affected storefront pages within seconds via a revalidation webhook. Today every page is dynamic SSR, which works but doesn't show the platform's reactive-rebuild story.
- **7f — Per-tenant theming.** The CSS vars are wired (`--brand`, `--brand-fg` in `globals.css`) but only one set of values is in play. The plan is to load the theme from the api per request based on tenant id.
- **7g** — this document.
- **Production CSP via nonce-based inline scripts.** See above.
- **shadcn/ui adoption.** Components currently styled with plain Tailwind.
- **Customer auth.** Today checkout is anonymous (cart cookie). Real customer accounts (sign-in, order history) require auth on the api and a storefront flow.
- **Storefront-scoped order reads.** `/orders/[id]` reads via the admin endpoint today. With customer auth, this gets a `/storefront/orders/:id` endpoint that verifies the requester actually placed the order.

## How to run

```bash
# Backend (one terminal)
docker compose up --build
pnpm seed

# Storefront (another terminal)
pnpm nx serve storefront

# Browser:
# http://t-fashion.localhost:3001/
# http://t-electronics.localhost:3001/
# http://t-books.localhost:3001/
```

Codegen against the live api:

```bash
pnpm nx run api-client:fetch-schema   # while api is up
pnpm codegen                          # rebuild typed documents
```

## Where to look in the code

| Concern | File |
|---|---|
| Tenant from Host | [apps/storefront/src/middleware.ts](../apps/storefront/src/middleware.ts) |
| urql RSC client | [apps/storefront/src/lib/urql.ts](../apps/storefront/src/lib/urql.ts) |
| REST fetch wrapper | [apps/storefront/src/lib/api-rest.ts](../apps/storefront/src/lib/api-rest.ts) |
| Cart cookie helpers | [apps/storefront/src/lib/cart.ts](../apps/storefront/src/lib/cart.ts) |
| Server actions | [apps/storefront/src/app/cart/actions.ts](../apps/storefront/src/app/cart/actions.ts) |
| Browse page | [apps/storefront/src/app/page.tsx](../apps/storefront/src/app/page.tsx) |
| Product detail | [apps/storefront/src/app/p/[id]/page.tsx](../apps/storefront/src/app/p/%5Bid%5D/page.tsx) |
| Cart shell + view | [apps/storefront/src/app/cart/page.tsx](../apps/storefront/src/app/cart/page.tsx), [cart-view.tsx](../apps/storefront/src/app/cart/cart-view.tsx) |
| Order confirmation | [apps/storefront/src/app/orders/[id]/page.tsx](../apps/storefront/src/app/orders/%5Bid%5D/page.tsx) |
| Security headers | [apps/storefront/next.config.mjs](../apps/storefront/next.config.mjs) |
| ESLint boundary | [.eslintrc.cjs](../.eslintrc.cjs) (search for `scope:storefront`) |
| api-client REST types | [packages/api-client/src/rest.ts](../packages/api-client/src/rest.ts) |
| api-client codegen | [packages/api-client/codegen.ts](../packages/api-client/codegen.ts) |
