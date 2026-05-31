# modules/cart

Redis-backed shopper cart. Throwaway (24h TTL), guest-style (opaque cart UUID), tenant-scoped via Redis key namespace.

## Public surface (`contracts/`)

- `Cart`, `CartLine`, `CartWithTotals`
- `AddItemDto`, `SetItemQtyDto`, `ApplyCouponDto`, `CreateCartResponse`
- `CART_SERVICE` token + `ICartService.{get, deleteCart, create}` for cross-module consumers (orders)

## Internals (`src/`)

- `cart.repository.ts` — Redis JSON at `cart:<cartId>` via `TenantRedis.forTenant(tenantId)`; 24h TTL
- `cart.service.ts` — implements `ICartService`; injects `TOTALS_SERVICE` (from pricing/contracts) for `get`-with-totals
- `cart.controller.ts` — REST under `/storefront/carts`
- `cart.module.ts` — `@Global`; registers `CART_SERVICE` token; doesn't import PricingModule (it's `@Global` too)

## REST endpoints

| Endpoint | Method | Notes |
|---|---|---|
| `/storefront/carts` | POST | creates, returns `{ cartId }` |
| `/storefront/carts/:id` | GET | returns cart with live-computed totals via TotalsService |
| `/storefront/carts/:id/items` | POST | `{ productId, sku, name, qty }`; sku+name snapshotted at add-time |
| `/storefront/carts/:id/items/:productId` | PATCH | `{ qty }`; qty=0 removes |
| `/storefront/carts/:id/coupon` | POST, DELETE | attach/detach coupon code |

## Why does the cart carry sku + name on each line?

The storefront UI already has these from the search response. By snapshotting at add-time, the order's checkout never has to reach back into the catalog module — preserves the cross-module boundary and lets a tenant rename a product without confusing in-flight carts.

The unit price is *not* cached on the cart line. Prices are read live from pricing on every GET-with-totals call. A price change updates open carts immediately, which is the right ecommerce behaviour (no stale-price ambushes at checkout).

## Tests

Cart logic is exercised end-to-end by `packages/modules/orders/src/checkout.integration.spec.ts`. Pure unit tests would re-test what that suite already validates against real Redis + Postgres.

## Deliberately not built

- Customer-scoped carts (auth dependency)
- Cart merging on login
- Saved carts / wishlists
- Inventory holds — cart never reserves stock; checkout never decrements
