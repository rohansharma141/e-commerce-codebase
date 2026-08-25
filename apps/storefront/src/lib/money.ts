/**
 * Money formatting, driven by what the api advertises rather than by
 * assumptions baked into the storefront.
 *
 * Two separate things used to be hardcoded here, and only one of them was
 * obvious:
 *
 *   1. the locale and currency symbol (`en-US`, `USD`)
 *   2. the *scale* — `cents / 100`
 *
 * The second is the dangerous one. Every money value in the api is an integer
 * in the currency's minor units, and the number of those units is a property
 * of the currency: 2 for USD and EUR, 0 for JPY. Dividing by 100 unconditionally
 * renders ¥1,000 as ¥10. The error is silent, plausible-looking, and would only
 * ever show up for a tenant nobody tested with — which is precisely why the api
 * now states `currencyMinorUnits` instead of leaving consumers to guess.
 */

export interface MoneyFormat {
  /** ISO 4217 code, e.g. USD. */
  readonly currency: string;
  /** Decimal places in this currency: 2 for USD, 0 for JPY. */
  readonly minorUnits: number;
  /** BCP-47 tag used for grouping and symbol placement. */
  readonly locale: string;
}

/**
 * Format an integer amount in minor units — what every api money field is.
 *
 * Intl is told the currency and works out the decimal places itself, so the
 * only thing `minorUnits` is needed for is undoing the integer scaling. Both
 * halves have to agree or the output is wrong in different ways: scale it by
 * 100 and format as JPY, and you get a number a hundred times too small with
 * no decimals to reveal it.
 */
export function formatMinorUnits(amount: number, fmt: MoneyFormat): string {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat(fmt.locale, {
    style: 'currency',
    currency: fmt.currency,
  }).format(amount / 10 ** fmt.minorUnits);
}

/**
 * Format a value that is already in major units.
 *
 * This is for the `price` custom attribute on a search document, which the
 * catalog stores in major units rather than minor — the one place in the
 * system where money is not an integer. See the "Price is denormalised into
 * the search index" entry in docs/CAVEATS.md for why that split exists.
 *
 * Tolerates junk and returns an em-dash, because attribute values are
 * tenant-defined: a tenant that has no `price` attribute, or types it as a
 * string, must not collapse the product grid.
 */
export function formatMajorUnits(value: unknown, fmt: MoneyFormat): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(fmt.locale, {
    style: 'currency',
    currency: fmt.currency,
  }).format(value);
}

/**
 * Format using a currency named by a payload rather than by the tenant's
 * capabilities — carts and orders each state their own.
 *
 * Today they always match: the api advertises `catalog.multiCurrency: false`,
 * and a cart is priced in the tenant's currency. Preferring the payload
 * anyway means a future multi-currency api doesn't silently mislabel historic
 * orders, which is the kind of thing that has to be right the day it changes,
 * not after someone notices.
 */
export function formatMinorUnitsIn(
  amount: number,
  currency: string | undefined,
  fmt: MoneyFormat,
): string {
  if (!currency || currency === fmt.currency) return formatMinorUnits(amount, fmt);
  return formatMinorUnits(amount, { ...fmt, currency });
}
