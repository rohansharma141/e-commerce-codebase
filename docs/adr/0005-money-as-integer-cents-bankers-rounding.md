# ADR-0005: Money as integer cents with banker's rounding

**Status:** Accepted
**Date:** 2026-05-29

## Context

Money math in JavaScript is a known source of bugs. `0.1 + 0.2 === 0.30000000000000004` is funny once and bankrupting forever. Standard percentage operations like "8.75% of $1,000,000" must produce *exactly* `$87,500.00` — not `$87,499.999...` or `$87,500.0001...` — when summed across thousands of line items, because a sub-cent of drift per line becomes dollars of drift per order and dollars per order becomes hundreds at the daily aggregate.

CLAUDE.md explicitly lists "pricing math" as one of the required test surfaces.

## Decision

**All monetary values are integer minor units (cents).** No `Money { amount: number, currency: string }` ever holds a non-integer `amount`. Float math on money is forbidden codebase-wide; ESLint and code review enforce.

**Percentages are stored as basis points** (1 bp = 0.01%). `8.75%` is `875`. Avoids float-percent ambiguity entirely; bps round-trip cleanly as integers.

**Percentage multiplication uses banker's rounding** (round-half-to-even). Implemented in [`packages/modules/pricing/contracts/src/money-ops.ts`](../../packages/modules/pricing/contracts/src/money-ops.ts) via BigInt:

```ts
mulBps(cents, bps): number
// cents * bps / 10000, rounded half-to-even using BigInt for the intermediate.
```

Banker's rounding is the IEEE-754 default and minimises systematic bias across aggregates: round-half-up biases all sums upward by ~0.5% on average for tied values, which compounds over thousands of line items. Banker's biases zero on tied values.

## Consequences

- The `mulBps` sentinel test pins the rounding policy with explicit half-cases:
  - `mulBps(100, 50) = 0` (0.5 → 0, round to even down)
  - `mulBps(300, 50) = 2` (1.5 → 2, round to even up)
  - `mulBps(500, 50) = 2` (2.5 → 2, round to even down)
  - `mulBps(700, 50) = 4` (3.5 → 4, round to even up)
  - `mulBps(100_000_000, 8875) = 88_750_000` (the big-number BigInt test)
- A reviewer can grep `mulBps` to find every place we apply a percentage and verify it routes through the same primitive.
- The order schema stores `subtotal_cents`, `discount_cents`, `tax_cents`, `grand_total_cents` — all `bigint`. No floats anywhere in the money pipeline.
- Tax convention: tax applies to `(subtotal − discount)`, not to the full subtotal. This is the common US convention and is documented in `totals-calculator.ts`. A different jurisdiction would change exactly one line.

## Alternatives considered

**JavaScript `Number` with care.** No matter how careful, a single forgotten `Math.round` produces a 0.001 cent drift that compounds. The discipline doesn't survive a year of contributors.

**A `Decimal.js`-style library.** Works, but it's a foreign math story for every line of code and slower than integer math. The cents-as-integers approach is what every real payments system does (Stripe, Adyen, Braintree all store amounts as integer minor units).

**Half-up rounding.** Simpler to explain ("round 5s up"), biases sums by 0.5% on tied values. Banker's is the same explanation length and unbiased.

**A `Money` type with currency arithmetic baked in.** A real implementation would prevent adding USD to EUR at the type level. We chose to leave currency as a string on the type but enforce single-currency-per-tenant in the data model — a `Money` class would be a fine future evolution but adds developer-experience cost that we don't repay at portfolio scale.

## Links

- [packages/modules/pricing/contracts/src/money-ops.ts](../../packages/modules/pricing/contracts/src/money-ops.ts) — `mulBps`, `clampNonNegative`, the pure primitives
- [packages/modules/pricing/contracts/src/money.ts](../../packages/modules/pricing/contracts/src/money.ts) — the discipline comment
- [packages/modules/pricing/contracts/src/totals-calculator.ts](../../packages/modules/pricing/contracts/src/totals-calculator.ts) — `computeTotals` ties it together
- **Test:** [packages/modules/pricing/src/totals/money-ops.spec.ts](../../packages/modules/pricing/src/totals/money-ops.spec.ts) — the banker's-rounding sentinels
- **Test:** [packages/modules/pricing/src/totals/totals-calculator.spec.ts](../../packages/modules/pricing/src/totals/totals-calculator.spec.ts) — discount/tax application
