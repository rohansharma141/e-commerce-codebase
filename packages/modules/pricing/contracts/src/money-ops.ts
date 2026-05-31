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

export function mulBps(cents: number, bps: number): number {
  if (!Number.isInteger(cents)) throw new Error(`mulBps: cents must be integer, got ${cents}`);
  if (!Number.isInteger(bps)) throw new Error(`mulBps: bps must be integer, got ${bps}`);
  if (bps === 0 || cents === 0) return 0;

  const product = BigInt(cents) * BigInt(bps); // scaled by 10000
  const divisor = 10_000n;
  const quotient = product / divisor;
  const remainder = product % divisor;
  const halfDivisor = divisor / 2n;

  if (remainder * 2n < divisor) {
    return Number(quotient);
  }
  if (remainder > halfDivisor) {
    return Number(quotient + 1n);
  }
  // exact .5 case: round to even
  return Number(quotient % 2n === 0n ? quotient : quotient + 1n);
}

export function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

export function bpsToPercentString(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2) + '%';
}
