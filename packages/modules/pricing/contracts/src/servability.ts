/**
 * Whether a tenant's price list can price in a given selling context (C-32,
 * gate G-4).
 *
 * `pricing.prices` holds one integer per product, in minor units of the
 * currency on `pricing.tenant_config`. A channel may declare another currency.
 * Charging the list's integers under the channel's currency would relabel GBP
 * amounts as EUR — the money bug ADR-0014 section 9 names — so a channel whose
 * currency differs from the price list's is **unservable**: nothing is priced
 * or sold in it. Per-channel price lists (Phase H) are what make such a channel
 * servable; until then the answer is a refusal, not a conversion.
 *
 * Framework-free on purpose: this is the rule, and every place that enforces
 * it — the money path, and the request edge — must ask this one function
 * rather than restate the comparison.
 */

/** The error code carried by every refusal, so a client can branch on it. */
export const CHANNEL_UNSERVABLE = 'channel.unservable' as const;

/**
 * The selling context a price is asked for.
 *
 * Declared here rather than imported from the channels contracts: pricing does
 * not depend on channels (see `TaxMode`), and a key and a currency are all it
 * needs. The field names match the channels module's resolved `ChannelConfig`
 * on purpose, so a resolved channel *is* a `PricingScope` structurally and
 * callers pass it as it is — no mapping for each consumer to keep in step.
 */
export interface PricingScope {
  /** The channel's key, for the refusal message. */
  readonly key: string;
  /** The channel's **resolved** currency — its own, or the one it inherits. */
  readonly currencyCode: string;
}

/** Why a scope cannot be priced. Every field is part of the 422 body. */
export interface UnservableChannel {
  readonly code: typeof CHANNEL_UNSERVABLE;
  readonly channel: string;
  readonly channelCurrency: string;
  readonly priceListCurrency: string;
}

/**
 * `null` when the price list can price in `scope`; otherwise the reason.
 *
 * Codes are compared trimmed and upper-cased. `pricing.tenant_config.currency`
 * is `char(3)` and channel currencies come from an allowlist, so neither should
 * carry padding or lower case — but "gbp" and "GBP" are the same currency, and
 * refusing a market over letter case would be a failure of this function, not
 * of the data.
 */
export function unservableChannel(
  priceListCurrency: string,
  scope: PricingScope,
): UnservableChannel | null {
  const listCurrency = normaliseCurrency(priceListCurrency);
  const channelCurrency = normaliseCurrency(scope.currencyCode);
  if (listCurrency === channelCurrency) return null;
  return {
    code: CHANNEL_UNSERVABLE,
    channel: scope.key,
    channelCurrency,
    priceListCurrency: listCurrency,
  };
}

function normaliseCurrency(code: string): string {
  return code.trim().toUpperCase();
}
