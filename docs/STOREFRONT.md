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
│    Query.search, Query.product, Query.theme, Query.capabilities (GraphQL)│
│    /storefront/carts/*, /storefront/checkout (REST)                      │
│    /admin/orders/:id (REST, used for confirmation today)                 │
└──────────────────────────────────────────────────────────────────────────┘
```

## Rendering split

| Route | Render | Cached on | Dropped by |
|---|---|---|---|
| `/` | Dynamic render, cached reads | `browse:<t>`, `browse:<t>:all` | any product change, and tenant-wide changes |
| `/c/[category]` | Dynamic render, cached reads | `browse:<t>`, `browse:<t>:category:<slug>` | a change in **that** category, and tenant-wide changes |
| `/p/[id]` | Dynamic render, cached reads | `product:<t>:<id>`, `browse:<t>` | that product's own events |
| `/cart` | `force-dynamic` | nothing | — personal, cookie-driven, no SEO value |
| `/orders/[id]` | `force-dynamic` | nothing | — personal, no SEO |

The routes are dynamic — tenant resolution reads the hostname, which rules out static generation — but the *data* is cached and tagged, which is where ISR's benefit actually lives. Measured on the running stack: two identical requests for a category page produce one `search.completed` in the api log, and editing a product in `laptop` rebuilds `/c/laptop` while `/c/camera` serves from cache untouched. A tenant-wide event drops both, which is the control proving the second number is a warm cache rather than an absent one.

**This depends on the read path being a GET, and that is not a detail.** Next's data cache stores GET responses; it accepts `next: { tags, revalidate }` on a POST and silently ignores it. While these reads were POSTs nothing was cached, every route re-queried the api, and every `revalidateTag` call in the webhook route invalidated something that did not exist — with no warning, because an empty cache is never stale. The api needed no change to support this: the schema already answers queries over GET, given Apollo's `apollo-require-preflight` header.

The api does now say its GET responses are storable. Apollo defaults every response to `cache-control: no-store`, which Next honours, so `graphql-cache.plugin.ts` replaces that with `private, max-age=0` for GET and — on every GraphQL response, cacheable or not — `Vary: x-tenant-id`. The tenant travels in a header, so `Vary` is what stops any cache keyed on the URL from serving one tenant's catalogue to another.

The cache-tag vocabulary is defined in `src/lib/cache-tags.ts` and consumed by `/api/revalidate`.

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

Static headers live in `apps/storefront/next.config.mjs`; the CSP is issued per request from `src/middleware.ts`.

| Header | Value | Set in |
|---|---|---|
| Content-Security-Policy | `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'`, `object-src 'none'`, `frame-ancestors 'none'`. Dev additionally allows `'unsafe-eval' 'unsafe-inline'` for HMR. | middleware |
| X-Frame-Options | `DENY` | next.config |
| X-Content-Type-Options | `nosniff` | next.config |
| Referrer-Policy | `no-referrer` | next.config |
| Permissions-Policy | Camera, mic, geolocation, FLoC all blocked | next.config |

**Why the CSP is split out.** `headers()` in `next.config.mjs` is evaluated at build time and yields one value for all requests, which cannot carry a nonce. Middleware runs per request, so that is where the nonce is minted. It is written to the *request* headers as well as the response: Next.js reads the inbound `content-security-policy`, extracts the nonce, and stamps it on the inline scripts it emits for the RSC payload and hydration. Set it only on the response and the policy blocks the very scripts the page needs — HTML renders, nothing hydrates.

`style-src` keeps `'unsafe-inline'`: Tailwind emits utility CSS inline and Next 14's app router nonces scripts only.

The api adds its own helmet baseline. Both layers carry independent headers so a misconfiguration on one doesn't silently weaken the other.

`/api/revalidate` is the one storefront route that authenticates, via a bearer token shared with the api. It fails closed — no secret configured means every request is refused. The dev value is checked in; [rotating it](RUNBOOK.md#rotating-the-revalidate-secret) is a restart of both sides, not a config reload.

## Theming and money — both come from the api

Neither is configured in the storefront. Both are fetched per request and cached under their own tag, so a tenant changing either reaches rendered pages in seconds rather than waiting out the hourly fallback.

**Theme** (`Query.theme`, tag `theme:<tenant>`) supplies brand name, logo mark, tagline, accent colour, page background *and page foreground*, and a font stack, applied as CSS variables in `layout.tsx`.

The foreground field is not decoration. A theme that sets a dark `pageBgHsl` against the storefront's previously-hardcoded `text-slate-800` produced dark-grey text on near-black — one of the three demo tenants was unreadable and nothing caught it, because the page rendered without error. The rule that resolves it, and which any new component must follow:

> A surface that paints its own background sets its own text colour. Anything sitting directly on the themed page background inherits and uses `opacity-*` for hierarchy.

That is why `Card`, `Input`, the sort control and the suggestions dropdown all carry an explicit `text-slate-800`, while empty states use `opacity-80` rather than a fixed slate.

**Money** (`Query.capabilities`, tag `capabilities:<tenant>`) supplies currency, the currency's minor-unit exponent and the locale. `lib/money.ts` formats from that descriptor and nothing else.

The exponent is the part that matters. Every money value in the api is an integer in minor units, and how many a currency has is a property of the currency — 2 for USD, 0 for JPY. The storefront used to divide by 100 unconditionally, which renders ¥1,000 as ¥10: silent, plausible, and only ever visible to a tenant nobody tested with. Verified by switching a tenant to JPY and to de-DE and watching prices re-render as `¥1,000` and `1.000,00 €` with no storefront change at all.

That last part is the point of the arrangement. Because the storefront asks rather than assumes, adding a per-tenant locale to the api was a column and a resolver line — no storefront deploy, no coordination between the two artifacts.

## Mobile-first

- Layout uses CSS Grid with mobile-first breakpoints: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` for the product grid; `lg:grid-cols-[260px_1fr]` for catalog-with-facets so the sidebar drops below the grid under `lg`.
- All interactive controls (qty +/−, add to cart, checkout) are full-width on mobile and keyboard-accessible.
- UI primitives (`Button`, `Card`, `Input`, `Badge`, `Skeleton`) follow the shadcn/ui pattern — Radix `Slot` for `asChild`, `class-variance-authority` for variants, `cn()` over `clsx` + `tailwind-merge` — hand-rolled in `src/components/ui/` rather than pulled in wholesale, so the surface stays limited to what the storefront actually uses.

## Tests

`pnpm nx test storefront` runs two suites:

- `src/lib/search-params.spec.ts` — the URL contract. Browse pages are a pure function of the URL, and those URLs get shared and bookmarked, so the page/cursor, facet, price-range, sort and view parsing are pinned. Runs anywhere, no infrastructure.
- `src/contract.integration.spec.ts` — storefront↔API conformance. Every operation the storefront issues in production is issued against a live api and checked against the shape the storefront relies on, including exact key sets for the hand-mirrored REST types so a drifted mirror fails loudly. Skipped unless `TEST_API_URL` is set:

  ```bash
  TEST_API_URL=http://localhost:3000 pnpm nx test storefront
  ```

The lint boundary proves the storefront never imports across the line; this suite proves the public surface actually delivers what the storefront reads. Both are needed — neither implies the other.

## What's NOT in the storefront yet

- **Customer auth.** Today checkout is anonymous (cart cookie). Real customer accounts (sign-in, order history) require auth on the api and a storefront flow.
- **Storefront-scoped order reads.** `/orders/[id]` reads via the admin endpoint today. With customer auth, this gets a `/storefront/orders/:id` endpoint that verifies the requester actually placed the order.
- **Price freshness on the PDP.** The product page reads `price` from the search document. The pricing module emits no domain events, so a price change doesn't invalidate the page until the next reindex or the one-hour backstop. See `CAVEATS.md`.

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
| api-client REST types | [packages/api-client/src/index.ts](../packages/api-client/src/index.ts) — curated names, aliased from [generated/rest-api.ts](../packages/api-client/src/generated/rest-api.ts) |
| api-client codegen | [packages/api-client/codegen.ts](../packages/api-client/codegen.ts) |
