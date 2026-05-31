# modules/pricing

Money configuration per tenant + the promotion engine. Pure-function math lives in `contracts/` so consumers (cart, orders) use the same code paths without crossing module boundaries.

## Public surface (`contracts/`)

### Pure utilities (no DI)

- `mulBps(cents, bps)` — banker's-rounded percentage multiplication via BigInt. See **[ADR-0005](../../../docs/adr/0005-money-as-integer-cents-bankers-rounding.md)**
- `computeTotals(input)` — subtotal → discount → tax → grand total
- `selectBest(candidates, ctx, now)` — best-single promotion selection. See **[ADR-0006](../../../docs/adr/0006-best-single-stacking-for-promotions.md)**

### Service tokens + interfaces

- `TOTALS_SERVICE` / `ITotalsService.compute(input)`
- `PRICES_QUERY` / `IPricesQuery.findByProductIds(tenantId, ids)`
- `PROMOTIONS_QUERY` / `IPromotionsQuery.listActiveCandidates(tenantId)`, `tryIncrementUsesCount(tenantId, id)`
- `TENANT_CONFIG_QUERY` / `ITenantConfigQuery.get(tenantId)`, `findOptional(tenantId)`

### DTOs

- `Money` (integer cents + ISO currency)
- `Bps` (basis points; integer)
- `Promotion`, `PromotionKind`, `PromotionCondition`, `PromotionAction`
- `AppliedPromotionSnapshot` — what gets persisted on `orders.order_promotion_snapshot`
- `Price`, `TenantConfig`, DTOs

## Internals (`src/`)

- `db/schema.ts` — `pricing.tenant_config`, `pricing.prices`, `pricing.promotions`
- `db/migrations/0001_init.sql`, `0002_rls.sql`
- `tenant-config/` — REST under `/admin/tenant-config`
- `prices/` — REST under `/admin/prices`
- `promotions/` — REST under `/admin/promotions`; `promotions.repository.ts` has the atomic `tryIncrementUsesCount` (conditional UPDATE) used by checkout
- `totals/totals.service.ts` — implements `ITotalsService`; ties everything together
- `pricing.module.ts` — `@Global`; registers all tokens; applies migrations on boot

## REST endpoints

| Endpoint | Method | Notes |
|---|---|---|
| `/admin/tenant-config` | PUT, GET | one row per tenant; currency must be ISO 4217 alpha-3; `taxRateBps` in `[0, 10000]` |
| `/admin/prices` | POST, GET | `unitPriceCents` non-negative integer |
| `/admin/promotions` | POST, GET, PATCH | full validation including `condition` shape per type |

## Tests of note

- `totals/money-ops.spec.ts` — banker's rounding sentinels (the load-bearing money correctness test)
- `totals/totals-calculator.spec.ts` — tax-on-discounted-subtotal convention, discount clamping
- `promotions/promotion-selector.spec.ts` — every selection edge case, best-single tie-breaker

## Deliberately not built

- BOGO, customer-segment targeting, true stacking — see [ADR-0006](../../../docs/adr/0006-best-single-stacking-for-promotions.md)
- Multi-currency conversion — single currency per tenant
- Time-window scheduling beyond `expires_at`
- Per-line discount distribution (today the discount applies at cart-total level)
