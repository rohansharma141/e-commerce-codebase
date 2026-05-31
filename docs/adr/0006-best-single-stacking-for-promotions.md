# ADR-0006: Best-single stacking for promotions

**Status:** Accepted
**Date:** 2026-05-29

## Context

The platform's promotion engine supports two kinds of promotion (coupon-code and automatic) with conditions (`always`, `cart-total-min`, `contains-product`) and actions (`percent`, `fixed`). When a cart matches multiple promotions, we need a stacking rule.

Real-world e-commerce systems support every conceivable stacking variant: priority order, mutually-exclusive groups, "best discount wins" vs "all discounts apply" vs "first applicable wins"; sometimes a hierarchy where category-level promos stack with coupons but cart-level don't stack with category-level; sometimes "stack on different totals" so a cart-level percent applies to the discounted subtotal after a coupon-level fixed. This is THE source of every promotion engine bug in production.

We had to pick *one* rule and pin it.

## Decision

**Best-single stacking.** From all applicable promotions, pick the one whose computed discount is largest. Ties broken by lexicographic promotion id. No combining, no priority lists, no group exclusion.

Implemented in [`packages/modules/pricing/contracts/src/promotion-selector.ts`](../../packages/modules/pricing/contracts/src/promotion-selector.ts) as a pure function:

```ts
selectBest(candidates, ctx, now): AppliedPromotionSnapshot | null
```

The selector evaluates every candidate's effective discount, filters out the ineligible (inactive, expired, exhausted, condition not met, coupon code mismatch), and returns the winner — or `null` if none apply.

## Consequences

- The stacking edge cases that plague real systems simply don't exist for us. There's nothing to combine, nothing to order, nothing to mutually exclude.
- The selector is a pure function — no DB, no IO. Trivially unit-testable; we test the empty list, every condition type, every action type, expired, exhausted, coupon mismatch, and the tie-breaker.
- The applied promotion is snapshotted into `orders.order_promotion_snapshot` at checkout time, so editing the live promotion later never mutates the historical order. See [ADR-0005](0005-money-as-integer-cents-bankers-rounding.md) for the money-math discipline.
- True stacking is documented as out of scope. Tenants that need "buy two get one free, AND 10% off carts over $100, AND tier-based discounts" need a different engine — and they're not the target audience for this platform.

## Alternatives considered

**Priority-list stacking.** Each promotion has a priority; multiple can apply in order. The flexibility is real but the bug surface is enormous. Specifically: tax interactions become weird ("does the second percent apply before or after the first percent?"), the order of application can flip the result by cents, and snapshot stability is harder because you have to capture each applied promotion plus the order they fired in.

**Mutually-exclusive groups.** Each promotion belongs to a group; one winner per group. Still need a winner-selection rule per group. Either harder to reason about than best-single or degenerates into it.

**Stack-everything.** Sum all applicable discounts. Easy to implement but customer-disastrous — a tenant can easily build a cart that nets negative grand totals. Defensible only with strict per-promo caps and per-line-item caps; that complexity dominates the savings.

**Configurable stacking strategy.** "Let tenants choose." Pushes the bug surface onto every tenant. The only safe configurable strategy is "best-single," because the alternatives all require tenant-side testing the platform can't validate.

## Links

- [packages/modules/pricing/contracts/src/promotion-selector.ts](../../packages/modules/pricing/contracts/src/promotion-selector.ts) — the pure function
- [packages/modules/pricing/contracts/src/promotion.dto.ts](../../packages/modules/pricing/contracts/src/promotion.dto.ts) — `Promotion`, `AppliedPromotionSnapshot`
- [packages/modules/orders/src/checkout.service.ts](../../packages/modules/orders/src/checkout.service.ts) — the consumption point with snapshot + race-safe `uses_count` increment
- **Test:** [packages/modules/pricing/src/promotions/promotion-selector.spec.ts](../../packages/modules/pricing/src/promotions/promotion-selector.spec.ts) — every selection edge case
- **Test:** [packages/modules/orders/src/checkout.integration.spec.ts](../../packages/modules/orders/src/checkout.integration.spec.ts) — the max_uses=1 race
