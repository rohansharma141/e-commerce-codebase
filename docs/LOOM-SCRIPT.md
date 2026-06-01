# Loom walkthrough script — storefront demo

A 2-3 minute screen recording aimed at non-technical reviewers (prospective clients, sponsors, executives) showing the multi-tenant storefront in action. The recording should make the platform story tangible in a way the architecture docs cannot.

**Total time:** ~2 min 45 sec
**Audience:** technical decision makers and the executives they brief, not engineers
**Tone:** confident, not salesy. The product does the talking.

---

## Before recording

Stand up the stack and pre-warm the search index so the first query in the recording is hot:

```powershell
docker compose up --build -d
pnpm install
pnpm seed
pnpm nx serve storefront
```

Browser tabs to have ready (in order):
1. `http://t-fashion.localhost:3001/`
2. `http://t-electronics.localhost:3001/`
3. `http://t-books.localhost:3001/`
4. `http://localhost:3000/docs` (Swagger)
5. `http://localhost:3000/graphql` (Apollo Sandbox or a saved Postman query)

Open dev tools' Network tab on tab 1 so you can show search latency.

Browser zoom: 110% — keeps text readable at 1080p.

Pin the cart icon and the latency badge in your head — those are the two visual proof points.

---

## Script

### [0:00 – 0:15] Opening — the framing

**Visual:** tab 1, home page, t-fashion storefront

> "This is a multi-tenant commerce platform — one codebase, many storefronts. Each tenant gets its own products, prices, promotions, even tax rate. The same Next.js app serves all of them; the tenant is identified by the subdomain you visit."

Hover the URL bar to highlight `t-fashion.localhost:3001`.

### [0:15 – 0:45] The hero — search

**Visual:** tab 1, still on home

> "The catalog you're seeing here is 33,000 products. The grid is server-rendered for SEO and performance. The sidebar on the left is faceted search — color, size, brand."

Click "blue" under Color, then "M" under Size.

> "Each click is a server request, no client-side JavaScript needed for filtering. Notice the latency badge in the top right."

Point at the `XX ms` indicator above the grid.

> "Under 20 milliseconds on 33,000 products with multi-attribute faceting. That's OpenSearch with one index per tenant — tenants never compete for index resources."

### [0:45 – 1:20] Multi-tenant in action

**Visual:** switch to tab 2 (t-electronics)

> "Now the same URL pattern on a different tenant subdomain. Different products — electronics, not clothing — but the same UI, same code path, same performance. Same searcher logic running against this tenant's index."

Switch to tab 3 (t-books).

> "And books. A third tenant. Notice the tenant chip in the header changes; that's coming from the Host header on every request. No tenant switcher dropdown, no manual config — the URL IS the tenant."

### [1:20 – 2:10] The purchase flow

**Visual:** back to tab 1 (t-fashion), click any product

> "Click into a product. This is the product detail page — name, custom attributes, price. Custom attributes are tenant-defined: t-fashion has color and size, electronics would have voltage and warranty period. The platform doesn't care."

Click "Add to cart".

> "Click. Adds the line, cart icon in the header updates. Let me add a second one."

Click "Add to cart" again.

Go to /cart by clicking the cart icon.

> "Cart shows the lines and the totals. Subtotal, automatic discount from a promotion the operator configured, tax — that's per-tenant, t-fashion is 8.75%. Coupon field. Checkout."

Click Checkout.

> "And we land on the order confirmation. The order has captured prices, applied promotions, and the tax rate as it was at the moment of checkout. If the catalog price changes tomorrow, this order does not. That's the snapshot integrity guarantee — financial records don't drift."

### [2:10 – 2:35] What's under the hood

**Visual:** switch to tab 4 (Swagger /docs)

> "Everything you just saw is the storefront calling the platform's public API — REST plus GraphQL. Swagger documents the REST surface. GraphQL handles search. The storefront is a thin presentation layer; every capability is reachable through the API alone, which is what lets us sell the API and the storefront as two separate products."

Switch briefly to tab 5 (GraphQL) and run the search query.

> "GraphQL search. Same latency. This is what the storefront grid is hitting under the hood — fully typed, generated client."

### [2:35 – 2:45] Close

**Visual:** back to the home page

> "Multi-tenant from day one. Hero search at p95 under twenty milliseconds. Database-level tenant isolation. Snapshot-integrity orders. One codebase serving any number of tenants, each with their own products, prices, promotions, and theme. That's the platform."

---

## Production tips

- Use the OBS-style picture-in-picture so a small webcam tile lives in the corner. People connect to faces.
- Cursor highlighting is worth turning on (macOS or PowerToys on Windows).
- Re-record the search-latency segment if the very first query was over 30ms — that hides the story.
- After recording, screenshot the cart page and the order confirmation page separately and use them as deck slides; the Loom is the live narrative, the screenshots are the leave-behind.

## Variants

- **Engineering-audience cut (5–6 min).** Add: split-screen with `docker compose logs api` showing the request flow, then the RLS killshot (`pnpm tsx ...` or psql), then audit-log table query.
- **Vertical short (45–60 sec).** Drop the multi-tenant comparison and the under-the-hood section. Catalog browse → PDP → add to cart → checkout. The conversion narrative.
