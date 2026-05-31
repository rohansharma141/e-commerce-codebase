/**
 * Money handling discipline for this codebase:
 *   - All monetary values are integer MINOR UNITS (cents/paise).
 *   - Float math is FORBIDDEN. No price/total/discount/tax goes through a
 *     JS number that could acquire a `.99999` artifact via float arithmetic.
 *   - Currency is ISO 4217 alpha-3 (e.g. "USD", "EUR", "INR"). Stored per tenant.
 *   - Percentages are stored as basis points (1 bp = 0.01%). 875 bps = 8.75%.
 *     Avoids float-percent ambiguity ("8.875%" rounds-trip cleanly as 8875).
 *   - Rounding rule for percentage operations is banker's rounding
 *     (half-to-even). See pricing/src/totals/money-ops.ts.
 */
export interface Money {
  /** Integer minor units. NEVER a float. */
  readonly amount: number;
  /** ISO 4217 alpha-3. */
  readonly currency: string;
}

export type Bps = number; // basis points; integer
