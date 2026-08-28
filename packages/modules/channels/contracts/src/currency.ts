/**
 * Currency minor units, derived rather than stored.
 *
 * The exponent is a property of the currency under ISO 4217 — 2 for GBP, 0 for
 * JPY, 3 for KWD — not a property of the channel. Storing an editable copy per
 * channel permits GBP-with-exponent-0, and every price on that channel is then
 * wrong by a factor of a hundred with nothing to flag it.
 *
 * `Intl.NumberFormat` is the source rather than a hand-kept table because the
 * runtime's CLDR data covers all of ISO 4217, including the three-decimal Gulf
 * currencies that hand-written tables routinely get wrong. (`capabilities`
 * still carries a five-entry table with a fallback of 2; it becomes redundant
 * at C-18, when capabilities composes from this contract.)
 */

/** Three ASCII letters. Intl throws `RangeError` on anything else. */
const CURRENCY_CODE_RE = /^[A-Za-z]{3}$/;

export class InvalidCurrencyCodeError extends Error {
  constructor(code: string) {
    super(`"${code}" is not a well-formed ISO 4217 code (expected three letters)`);
    this.name = 'InvalidCurrencyCodeError';
  }
}

/**
 * Decimal places for an ISO 4217 code. Throws on a malformed code.
 *
 * **Known limit, pinned by a test rather than left to be discovered:** a
 * well-formed but unassigned code (`XYZ`) returns 2, because Intl reports the
 * CLDR default for anything it does not recognise instead of failing. That is
 * indistinguishable here from a real 2-decimal currency.
 *
 * The place to catch a typo'd currency is therefore write-time validation
 * against the set of currencies a deployment supports (C-8), not this function.
 * Read that boundary as deliberate: this answers "how many decimals does this
 * currency have", not "is this a currency".
 */
export function minorUnitsFor(currencyCode: string): number {
  if (!CURRENCY_CODE_RE.test(currencyCode)) {
    throw new InvalidCurrencyCodeError(currencyCode);
  }
  const { maximumFractionDigits } = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).resolvedOptions();

  // The lib types mark this optional because it is, for other number styles.
  // Under `style: 'currency'` every runtime resolves it, so an undefined here
  // means the environment is not one we understand — say so rather than
  // defaulting to 2, which is the silent hundred-fold error this whole module
  // exists to prevent.
  if (typeof maximumFractionDigits !== 'number') {
    throw new InvalidCurrencyCodeError(currencyCode);
  }
  return maximumFractionDigits;
}
