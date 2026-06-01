# ADR-0011: Cart and checkout mutate via Next.js server actions, not browser→api CORS

**Status:** Accepted
**Date:** 2026-06-01

## Context

The cart and checkout flow is client-rendered: cart is a personal page, no SEO value, lots of interactivity. Two obvious ways to wire the mutations:

1. Browser → api directly. Add CORS on the api allowing the storefront origin. The browser POSTs to `/storefront/carts/:id/items`, `/storefront/checkout`, etc.
2. Browser → Next.js server action → api. The browser fetches the same Next.js origin (the storefront). The storefront's server-side handler then calls the api server-to-server.

Both work. They have very different security and operational profiles.

## Decision

Use Next.js server actions for every cart, coupon, and checkout mutation. The browser never makes a direct request to the api.

`apps/storefront/src/app/cart/actions.ts` declares the mutators with `'use server'`. Client components import them like normal functions; React + Next handle the RPC wire format transparently.

Each action:
1. Reads the tenant id from headers (set by the storefront's middleware on each request).
2. Reads or creates a `cart_id_<tenantId>` cookie via `next/headers` `cookies()`.
3. Calls the api via the server-only `apiFetch` wrapper, which attaches the tenant header.
4. Calls `revalidatePath('/cart')` and `revalidatePath('/', 'layout')` so the cart page and header count re-fetch on the next render.

The api remains pure REST without CORS. From the api's perspective, every storefront mutation looks identical to any other server-to-server caller (an admin tool, an integration partner, the seed CLI).

## Consequences

**Security:**
- The api's origin is invisible to the browser. No `API_ORIGIN` env in the client bundle; `process.env['API_ORIGIN']` is only read in `apps/storefront/src/lib/api-rest.ts` which has a `'server-only'` import guard.
- No CORS preflight machinery. The api never has to maintain an allowed-origins list. Adding a new storefront tenant doesn't touch the api's config.
- Tenant header injection is centralised in middleware → ALS → `getTenantId()`. A misbehaving client cannot spoof `x-tenant-id` toward the api because the browser never makes that request.
- HTTP-only-able cart cookies. Today they're regular cookies (cart id is not a secret) but the path to HTTP-only is straightforward.
- Built-in CSRF protection: Next.js server actions enforce same-origin by default. Cross-origin POSTs are rejected without further config.

**Operational:**
- Single deployment story: the storefront fronts both render and mutation. No "what's between the browser and the api" diagram with a CORS proxy in it.
- Easier rate limiting / WAF: edge rules apply uniformly to all storefront traffic.
- Easier audit logging on the storefront side if needed (per-tenant abuse, etc.).

**Trade-offs:**
- The storefront server has to be up to mutate. An api-only deployment scaled separately from the storefront still requires the storefront process for cart operations. For api-only customers, this is fine — they don't use the storefront.
- Server actions are a Next.js-specific RPC mechanism. If we ever swap the storefront framework, every action becomes a server route to re-implement. Reduced framework portability is the price of the security posture.
- One additional hop on every cart click (browser → Next.js → api vs. browser → api directly). In dev on localhost, sub-millisecond. In a production deployment with Next.js and api in the same VPC, single-digit ms.

## Alternatives considered

**CORS-enabled browser → api.** Simpler from the api's perspective. Rejected because exposing the api origin to the browser would force us to maintain an allowed-origins list per tenant subdomain, manage CORS preflight responses, and either trust the tenant header coming from the browser (which is forgeable) or implement a separate browser-auth scheme. Server actions cleanly sidestep all of this.

**A bespoke Next.js API route (`app/api/cart/route.ts`) per mutation.** Equivalent in security posture but more boilerplate. Server actions are the Next.js-native way to express the same intent. `'use server'` declares the same boundary explicitly.

**RPC via tRPC or similar.** Overkill for this platform — server actions are the simpler primitive and they're already in the framework we picked.

## Links

- [apps/storefront/src/app/cart/actions.ts](../../apps/storefront/src/app/cart/actions.ts) — the action surface
- [apps/storefront/src/lib/api-rest.ts](../../apps/storefront/src/lib/api-rest.ts) — `server-only` fetch wrapper
- [apps/storefront/src/lib/cart.ts](../../apps/storefront/src/lib/cart.ts) — cart cookie helpers
- [apps/storefront/src/app/p/[id]/add-to-cart-button.tsx](../../apps/storefront/src/app/p/%5Bid%5D/add-to-cart-button.tsx) — example client component calling an action
