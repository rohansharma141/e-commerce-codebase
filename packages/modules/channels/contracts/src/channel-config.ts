import type {
  Channel,
  ChannelConfig,
  InheritedFields,
  ResolvedChannel,
  TenantDefaults,
} from './channel.dto';
import { minorUnitsFor } from './currency';

/**
 * Coalesce a channel over its tenant's defaults.
 *
 * Pure and dependency-free, so it can be unit-tested exhaustively without a
 * database and reused unchanged by the repository (C-7), the read-models in
 * consuming modules (C-14) and the back office (C-24). Inheritance resolved in
 * three places by three slightly different implementations is how a tenant ends
 * up with a currency that depends on which endpoint you ask.
 *
 * `null` on the channel means **inherit**. It never means "empty": a channel
 * cannot opt out of having a currency, only decline to override one.
 */
export function resolveChannelConfig(
  channel: Channel,
  defaults: TenantDefaults,
): ResolvedChannel {
  const inherited = new Set<keyof ChannelConfig>();

  /**
   * Records provenance as a side effect of choosing a value, so the two cannot
   * disagree. Tracking inheritance separately from resolving it is how the back
   * office ends up showing "inherited" next to an overridden value.
   */
  const pick = <K extends keyof ChannelConfig>(
    field: K,
    override: ChannelConfig[K] | null,
    fallback: ChannelConfig[K],
  ): ChannelConfig[K] => {
    if (override === null) {
      inherited.add(field);
      return fallback;
    }
    return override;
  };

  const currencyCode = pick('currencyCode', channel.currencyCode, defaults.currencyCode);

  const config: ChannelConfig = {
    channelId: channel.id,
    tenantId: channel.tenantId,
    key: channel.key,
    name: channel.name,
    status: channel.status,
    isDefault: channel.isDefault,

    currencyCode,
    // Derived from the resolved currency, never inherited as a value of its
    // own — see currency.ts. It is therefore deliberately absent from
    // `inherited`: it is not a field anyone can override.
    currencyMinorUnits: minorUnitsFor(currencyCode),

    defaultLocale: pick('defaultLocale', channel.defaultLocale, defaults.defaultLocale),
    supportedLocales: pick(
      'supportedLocales',
      channel.supportedLocales,
      defaults.supportedLocales,
    ),
    country: pick('country', channel.country, defaults.country),
    timezone: pick('timezone', channel.timezone, defaults.timezone),
    taxDisplay: pick('taxDisplay', channel.taxDisplay, defaults.taxDisplay),
    // taxRateBps is nullable on BOTH sides, so `null` on the channel is
    // ambiguous between "inherit" and "no rate". It resolves as inherit,
    // consistent with every other field: a channel declines to override, it
    // does not assert an absence. Setting no tax is expressed at tenant level.
    taxRateBps: pick('taxRateBps', channel.taxRateBps, defaults.taxRateBps),
  };

  return { config, inherited: inherited as InheritedFields };
}
