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
│                      ── /{channel}/… → x-channel-key (C-19a)             │
│        │                                                                 │
│        ▼                                                                 │
│   ┌───────── App Router pages ─────────┐    ┌──── Server actions ────┐   │
│   │  RSC (server components)           │    │  'use server' in       │   │
│   │  ├─ /          home (browse)       │    │  (shop)/cart/actions   │   │
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

## Channel resolution

A channel is named by the path's first segment, and the tenant's default channel by its absence (C-19a). That is the api's own grammar — `/api/{tenant}/{channelKey}/graphql`, default omitted rather than reserved — carried into the shopper's URL. The middleware strips the prefix and rewrites, so the routes stay one tree with no per-channel copy, and passes the key on as an internal `x-channel-key` header after deleting any copy the client sent.

| Path on `t-fashion.localhost:3001` | Outcome |
|---|---|
| `/c/dresses` | the default channel, `uk` |
| `/trade/c/dresses` | channel `trade`; every link on the page stays under `/trade` |
| `/uk/c/dresses` | channel `uk`, named explicitly |
| `/xx/c/dresses`, or an archived channel's key | `404` — never the default |
| `/de/c/dresses`, a channel the price list cannot serve | the market's own page, `200` and `noindex` |
| `/c/…`, `/p/…`, `/cart`, `/orders/…`, `/api/…` | the storefront's own routes, never read as a channel |

Whether a key names a channel is the api's answer: `(shop)/layout.tsx` asks for the channel's capabilities under the scoped URL and turns the api's `404` into the storefront's. That layout rather than the root one, because a `notFound()` thrown by the root layout falls outside the root's own not-found boundary and renders an empty page — the status is still `404`, which is why only rendering it showed the difference.

A channel the api refuses — its currency is one the price list cannot serve, so every storefront request in it is `422 channel.unservable` (C-32b) — gets that same layout's *market's own page* instead of any product page (C-19d): "Not available in this market", inside the tenant's frame, with a link to the default channel. `200` rather than `404`, because the page exists and the link the shopper followed was valid; `noindex` on the segment keeps it out of search results, which is what a `404` would have bought. Next's app router offers a page those two answers and no third, so the api's `422` cannot be passed through. The layout returns the message *instead of* its children, so no page underneath asks the api a question it has already refused — and `generateMetadata`, which resolves separately from rendering, asks the same question first for the same reason.

A tenant whose *default* channel is unservable has nowhere to read anything, the theme included. The frame then renders with a neutral fallback theme and no "main store" link, because there is no other market to offer.

Every read then names that channel, in the URL and the header (C-19b). `graphqlQuery` reads it per call, as it reads the tenant, so no caller can forget it. An unprefixed page names the default **by its key**, learned from `GET /system/capabilities` — the one read the api answers without a channel — and cached under the capabilities tag, so a new default reaches those pages as soon as `channels.default-changed` arrives. That is what lets the api stop treating an absent channel as the default (C-42, ADR-0014 §8) without breaking this storefront. Carts and checkout follow in C-19e.

The cost of spending the first segment on the channel is in [CAVEATS](CAVEATS.md#the-storefronts-channel-prefix-has-two-costs).

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

**Money** (`Query.capabilities`, tag `capabilities:<tenant>`) supplies currency, the currency's minor-unit exponent and the locale — since C-19b from `capabilities.channel`, the request's channel, rather than the deprecated tenant-level fields that answer for the default channel whatever was asked. `lib/money.ts` formats from that descriptor and nothing else.

The exponent is the part that matters. Every money value in the api is an integer in minor units, and how many a currency has is a property of the currency — 2 for USD, 0 for JPY. The storefront used to divide by 100 unconditionally, which renders ¥1,000 as ¥10: silent, plausible, and only ever visible to a tenant nobody tested with. Verified by switching a tenant to JPY and to de-DE and watching prices re-render as `¥1,000` and `1.000,00 €` with no storefront change at all.

That last part is the point of the arrangement. Because the storefront asks rather than assumes, adding a per-tenant locale to the api was a column and a resolver line — no storefront deploy, no coordination between the two artifacts.

## Mobile-first

- Layout uses CSS Grid with mobile-first breakpoints: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` for the product grid; `lg:grid-cols-[260px_1fr]` for catalog-with-facets so the sidebar drops below the grid under `lg`.
- All interactive controls (qty +/−, add to cart, checkout) are full-width on mobile and keyboard-accessible.
- UI primitives (`Button`, `Card`, `Input`, `Badge`, `Skeleton`) follow the shadcn/ui pattern — Radix `Slot` for `asChild`, `class-variance-authority` for variants, `cn()` over `clsx` + `tailwind-merge` — hand-rolled in `src/components/ui/` rather than pulled in wholesale, so the surface stays limited to what the storefront actually uses.

## Tests

`pnpm nx test storefront` runs twelve suites, among them:

- `src/middleware.spec.ts` and `src/lib/channel-path.spec.ts` — channel resolution (C-19a): which paths name a channel, that a client-sent `x-channel-key` never survives the middleware, and that every top-level route is reserved so none is mistaken for a channel key.
- `src/lib/api-graphql.spec.ts` — the read path is a GET carrying the tenant, and every read names the request's channel in both URL and header, per call.
- `src/lib/channel-key.spec.ts` and `src/lib/capabilities.spec.ts` — an unprefixed page names the default by the key `/system/capabilities` reports, and money is formatted in the request's channel rather than from the default's aliases.
- `src/lib/channel.spec.ts`, `src/lib/theme.spec.ts` and `src/app/(shop)/p/[id]/page.spec.ts` — the three outcomes an api answer becomes (serves, unknown, unservable), the frame's fallback when nothing can be read, and metadata asking before it reads.
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
| Channel from path | [lib/channel-path.ts](../apps/storefront/src/lib/channel-path.ts) (grammar), [lib/channel-key.ts](../apps/storefront/src/lib/channel-key.ts) (the key every call names), [lib/channel.ts](../apps/storefront/src/lib/channel.ts) (asking the api), [(shop)/layout.tsx](../apps/storefront/src/app/%28shop%29/layout.tsx) (the `404` and the closed market) |
| urql RSC client | [apps/storefront/src/lib/urql.ts](../apps/storefront/src/lib/urql.ts) |
| REST fetch wrapper | [apps/storefront/src/lib/api-rest.ts](../apps/storefront/src/lib/api-rest.ts) |
| Cart cookie helpers | [apps/storefront/src/lib/cart.ts](../apps/storefront/src/lib/cart.ts) |
| Server actions | [apps/storefront/src/app/(shop)/cart/actions.ts](../apps/storefront/src/app/%28shop%29/cart/actions.ts) |
| Browse page | [apps/storefront/src/app/(shop)/page.tsx](../apps/storefront/src/app/%28shop%29/page.tsx) |
| Product detail | [apps/storefront/src/app/(shop)/p/[id]/page.tsx](../apps/storefront/src/app/%28shop%29/p/%5Bid%5D/page.tsx) |
| Cart shell + view | [apps/storefront/src/app/(shop)/cart/page.tsx](../apps/storefront/src/app/%28shop%29/cart/page.tsx), [cart-view.tsx](../apps/storefront/src/app/%28shop%29/cart/cart-view.tsx) |
| Order confirmation | [apps/storefront/src/app/(shop)/orders/[id]/page.tsx](../apps/storefront/src/app/%28shop%29/orders/%5Bid%5D/page.tsx) |
| Security headers | [apps/storefront/next.config.mjs](../apps/storefront/next.config.mjs) |
| ESLint boundary | [.eslintrc.cjs](../.eslintrc.cjs) (search for `scope:storefront`) |
| api-client REST types | [packages/api-client/src/index.ts](../packages/api-client/src/index.ts) — curated names, aliased from [generated/rest-api.ts](../packages/api-client/src/generated/rest-api.ts) |
| api-client codegen | [packages/api-client/codegen.ts](../packages/api-client/codegen.ts) |
