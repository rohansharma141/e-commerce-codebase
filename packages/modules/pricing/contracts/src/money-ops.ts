/**
 * Money arithmetic primitives — pure functions, no IO. Lives in contracts
 * because callers across the platform (cart, orders, future tax/fulfillment)
 * need to apply the same rounding rules.
 *
 * All inputs/outputs are integer cents. NO FLOAT MATH on monetary values.
 * Percent operations route through bps (basis points, integer) to avoid
 * "8.875%" round-trip ambiguity. Final rounding uses banker's rounding
 * (round-half-to-even) which is the IEEE-754 default and minimises bias
 * over large aggregates.
 */

/**
 * Divide with banker's rounding (round-half-to-even), on BigInt so the
 * intermediate product never touches a float.
 *
 * Extracted so `mulBps` and `taxIncludedIn` share one rounding implementation.
 * Two copies of a rounding policy is how a platform ends up computing tax one
 * way when adding it and another way when extracting it, with the difference
 * only visible at the aggregate.
 *
 * Both arguments must be non-negative; money here never is.
 */
function divRoundHalfEven(numerator: bigint, denominator: bigint): number {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twiceRemainder = remainder * 2n;

  if (twiceRemainder < denominator) return Number(quotient);
  if (twiceRemainder > denominator) return Number(quotient + 1n);
  // exact .5 case: round to even
  return Number(quotient % 2n === 0n ? quotient : quotient + 1n);
}

export function mulBps(cents: number, bps: number): number {
  if (!Number.isInteger(cents)) throw new Error(`mulBps: cents must be integer, got ${cents}`);
  if (!Number.isInteger(bps)) throw new Error(`mulBps: bps must be integer, got ${bps}`);
  if (bps === 0 || cents === 0) return 0;

  return divRoundHalfEven(BigInt(cents) * BigInt(bps), 10_000n);
}

/**
 * The tax **contained within** a tax-inclusive (gross) amount.
 *
 * Gross pricing is the European retail convention: the shelf price already
 * includes VAT, and the customer pays exactly what is advertised. So tax is not
 * added — it is decomposed out for the receipt and the tax return.
 *
 *     gross = net + tax,  tax = net × rate
 *     gross = net × (1 + rate)
 *     tax   = gross − net = gross × rate / (1 + rate)
 *
 * In basis points that is `gross × bps / (10000 + bps)`, which is why this is
 * not `mulBps` with a different rate: the divisor carries the rate too. Using
 * `mulBps(gross, bps)` here would overstate tax — 20% of a gross £120 is £24,
 * but the VAT inside £120 is £20.
 *
 * The caller derives net as `gross − taxIncludedIn(gross, bps)` rather than
 * rounding it separately, which makes `net + tax === gross` true **by
 * construction**. Rounding both halves independently loses or invents a cent
 * on roughly half of all amounts, and that cent lands on a customer's receipt.
 */
export function taxIncludedIn(grossCents: number, bps: number): number {
  if (!Number.isInteger(grossCents)) {
    throw new Error(`taxIncludedIn: cents must be integer, got ${grossCents}`);
  }
  if (!Number.isInteger(bps)) {
    throw new Error(`taxIncludedIn: bps must be integer, got ${bps}`);
  }
  if (bps === 0 || grossCents === 0) return 0;
  if (bps < 0) throw new Error(`taxIncludedIn: bps must be non-negative, got ${bps}`);

  return divRoundHalfEven(
    BigInt(grossCents) * BigInt(bps),
    10_000n + BigInt(bps),
  );
}

export function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

export function bpsToPercentString(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2) + '%';
}
