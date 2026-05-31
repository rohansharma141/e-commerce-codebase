# modules/orders

The transactional core. Cart → durable order, with idempotency, snapshot stability, and concurrent-promo-consumption race safety.

## Public surface (`contracts/`)

- `Order`, `OrderLine`, `OrderStatus`, `CheckoutDto`
- `ORDERS_EVENTS.Created` = `'orders.created'`
- `OrderCreatedPayload`

## Internals (`src/`)

- `db/schema.ts` — `orders.orders`, `orders.order_lines`, `orders.order_promotion_snapshot`, `orders.idempotency_keys`
- `db/migrations/0001_init.sql` — schema
- `db/migrations/0002_rls.sql` — FORCE RLS on all four tables; child tables enforce via subquery against parent `orders.tenant_id`
- `orders.repository.ts` — list/get with FK assembly
- `checkout.service.ts` — **the** load-bearing flow
- `orders.controller.ts` — REST: `POST /storefront/checkout`, `GET /admin/orders`, `GET /admin/orders/:id`
- `orders.module.ts` — applies migrations on boot

## The checkout flow

```
checkout(tenantId, cartId, idempotencyKey?):

  1. If idempotencyKey: look up orders.idempotency_keys; if hit, return existing.
  2. Load cart from Redis (via CART_SERVICE).
  3. Load tenant_config (currency, taxRateBps).
  4. Load prices for every line.
  5. Build pricedLines (using cart's snapshotted sku/name + pricing's live unit prices).
  6. Compute subtotal; select best promotion (via pricing.selectBest).
  7. If a promo was selected: try to consume via promotions.tryIncrementUsesCount.
     If the consume returns false (race lost), fall back to no-promo.
  8. computeTotals(...) — single source of truth for the money math.
  9. Dispatch HOOK_NAMES.OrderBeforeCreate (observer; not yet mutating).
 10. BEGIN on the request's reserved Postgres connection.
 11. INSERT orders.orders, orders.order_lines, orders.order_promotion_snapshot.
 12. If idempotencyKey: INSERT orders.idempotency_keys (unique-violation = race; re-fetch existing).
 13. COMMIT.
 14. Best-effort: cart deletion in Redis.
 15. Publish orders.created on the event bus.
```

## Why is the transaction opened on `currentTenantBinding().reserved` directly?

Drizzle-postgres-js's `db.transaction()` resolves to the *parent* `sql` client's `begin()` — which pulls a fresh pool connection without `app.tenant_id`, and RLS blocks every insert. The fix is to issue BEGIN/COMMIT on the request's reserved connection; the single-statement `db.insert(...)` calls route correctly through the Proxy. See the comment at the tx site.

## Tests of note

- `checkout.integration.spec.ts` (real Postgres + Redis):
  - Happy path: cart → order, totals snapshotted, cart cleared
  - Idempotency: same `Idempotency-Key` never produces two orders (returns existing on retry)
  - Snapshot integrity: editing a live promotion after checkout never mutates historical order
  - Max_uses=1 race: concurrent checkouts; one wins discount, one falls back
  - Cross-tenant 404: RLS-enforced invisibility

## Deliberately not built

- Payment integration (status stays `'created'`). See [ADR-0007](../../../docs/adr/0007-tenant-id-as-trust-gateway-responsibility.md) for the future-auth note.
- Order lifecycle beyond create (pending_payment, paid, shipped, cancelled, refunded)
- Shipping
- Order edits / refunds
- A storefront/admin UI for browsing orders
