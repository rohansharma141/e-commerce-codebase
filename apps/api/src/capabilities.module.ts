import { Field, Int, ObjectType, Query, Resolver, registerEnumType } from '@nestjs/graphql';
import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  CHANNEL_QUERY,
  minorUnitsFor,
  type ChannelConfig,
  type IChannelsQuery,
} from '@platform/modules/channels/contracts';
import {
  TENANT_CONFIG_QUERY,
  type ITenantConfigQuery,
  type TenantConfig,
} from '@platform/modules/pricing/contracts';
import { currentTenantOrThrow } from '@platform/shared/tenant-context';
import { defaultChannelOrNull, requestChannel } from './request-channel';

/**
 * `Query.capabilities` — the API describing itself.
 *
 * Every other endpoint answers a question about a tenant's data. This one
 * answers questions about the API: what currency this tenant trades in, how
 * many minor units that currency has, which locale to format it in, whether
 * tax is added at checkout or already in the listed price, and which
 * capabilities this deployment actually implements.
 *
 * Why it exists: the platform is sold as a standalone product, and a consumer
 * had no way to discover any of that. Our own storefront used to paper over
 * the gap by hardcoding `en-US`, a `$` prefix and two decimal places — which
 * only worked because the same author wrote both sides. It now formats from
 * this endpoint instead, which is what proves the endpoint sufficient rather
 * than merely present: a tenant switched to JPY or de-DE re-renders correctly
 * with no storefront change at all. A headless product that cannot describe
 * itself is incomplete regardless of how many features it has.
 *
 * Lives in the composition root rather than a domain module on purpose.
 * Capabilities are a property of the assembled deployment — which modules are
 * wired in, what this build supports — and no single domain module knows that.
 * Putting it in `pricing` because that happens to be where currency is stored
 * would repeat the mistake documented for branding in CAVEATS.md.
 *
 * ── Channel-aware since C-18 (ADR-0014 section 7) ─────────────────────────
 *
 * `channel` describes the channel the request is in — the one it named, or
 * the tenant default — composed from the channels contract. The tenant-level
 * `currency`, `currencyMinorUnits`, `defaultLocale` and `locales` are kept as
 * deprecated aliases, and answer for the tenant DEFAULT channel even when the
 * request names another: that is what they always meant, and a consumer
 * reading them must not have their meaning change underneath it. The
 * storefront moved to `channel` in C-19b; the aliases go in C-19c.
 *
 * `taxRateBps` and `taxDisplay` are deliberately NOT under `channel` yet.
 * They describe the money path, and the money path still charges the price
 * list's rate and adds tax on top, whatever a channel is configured with.
 * Advertising a channel's own rate here would describe a tax nobody charges —
 * gate G-4's shape again. They move when C-38 (rate) and C-30 (display) make
 * them charged per channel. `currency` has no such problem: since C-32 a
 * channel whose currency the price list cannot serve is refused before this
 * runs, so for any channel answered here, the currency is the charged one.
 *
 * On exposing currency and taxRateBps here: BrandingResolver deliberately
 * keeps them out of `Query.theme`, and that stays true — a theme query has no
 * business carrying tax config. Both values are already public to any
 * storefront through `ComputedTotals` on the cart REST surface, so stating
 * them on an endpoint whose entire purpose is self-description leaks nothing
 * new. Admin-only settings stay on the admin REST surface.
 */

export enum TaxDisplay {
  /** Listed prices exclude tax; it is added during checkout. */
  EXCLUSIVE = 'EXCLUSIVE',
  /** Listed prices already include tax. Not implemented today. */
  INCLUSIVE = 'INCLUSIVE',
}

registerEnumType(TaxDisplay, {
  name: 'TaxDisplay',
  description: 'Whether listed prices include tax.',
});

/**
 * Carries both GraphQL and Swagger decorators on purpose. The two surfaces
 * are meant to describe the identical shape — that is the entire promise of
 * the REST mirror — and one decorated class is the only way to make that true
 * by construction rather than by two definitions someone has to keep in step.
 */
@ObjectType({ description: 'A named capability of this deployment.' })
export class CapabilityFeature {
  @Field(() => String, { description: 'Stable dotted key, e.g. promotions.coupon' })
  @ApiProperty({ example: 'promotions.coupon' })
  key!: string;

  @Field(() => Boolean)
  @ApiProperty()
  enabled!: boolean;
}

/** Reason text shared by every deprecated tenant-level field. */
const DEPRECATED_FOR_CHANNEL = (field: string): string =>
  `Use channel.${field}. This answers for the tenant's default channel even when the ` +
  `request names another (ADR-0014 section 7).`;

@ObjectType({
  description:
    'The channel a request is served in: the one it named, or the tenant default. Everything here is resolved — inherited values are filled in.',
})
export class ChannelCapabilities {
  @Field(() => String, { description: 'Stable, URL-safe identifier, e.g. uk.' })
  @ApiProperty({ example: 'uk' })
  key!: string;

  @Field(() => String)
  @ApiProperty({ example: 'United Kingdom' })
  name!: string;

  @Field(() => Boolean, { description: 'Whether requests that name no channel are served in this one.' })
  @ApiProperty()
  isDefault!: boolean;

  @Field(() => String, {
    description:
      'ISO 4217. For any channel this answers for, also the currency its prices are charged in: a channel the price list cannot serve is refused instead.',
  })
  @ApiProperty({ example: 'GBP' })
  currency!: string;

  @Field(() => Int, {
    description:
      'Decimal places in the currency. Every money value in this API is an integer in minor units: 19999 with minorUnits 2 is 199.99.',
  })
  @ApiProperty({ example: 2 })
  currencyMinorUnits!: number;

  @Field(() => String, { description: 'BCP-47 tag money and dates are formatted in.' })
  @ApiProperty({ example: 'en-GB' })
  defaultLocale!: string;

  @Field(() => [String], { description: 'BCP-47 tags this channel serves. Formatting, not translation.' })
  @ApiProperty({ type: [String], example: ['en-GB'] })
  locales!: string[];

  @Field(() => String, { description: 'ISO 3166-1 alpha-2.' })
  @ApiProperty({ example: 'GB' })
  country!: string;

  @Field(() => String, { description: 'IANA time zone.' })
  @ApiProperty({ example: 'Europe/London' })
  timezone!: string;
}

@ObjectType({ description: 'What this API supports, for the calling tenant.' })
export class CapabilitiesType {
  @Field(() => String)
  @ApiProperty({ example: 't-fashion' })
  tenantId!: string;

  @Field(() => String, { description: 'Version of the platform serving this request.' })
  @ApiProperty({ example: '0.1.0' })
  apiVersion!: string;

  @Field(() => ChannelCapabilities, {
    nullable: true,
    description:
      'The channel this request is served in: the one it named, or the tenant default. Null only for a tenant with no channel at all.',
  })
  @ApiProperty({ type: ChannelCapabilities, nullable: true })
  channel!: ChannelCapabilities | null;

  @Field(() => String, {
    description: 'ISO 4217 code of the tenant default channel.',
    deprecationReason: DEPRECATED_FOR_CHANNEL('currency'),
  })
  @ApiProperty({
    example: 'USD',
    description: 'ISO 4217 code of the tenant default channel.',
    deprecated: true,
  })
  currency!: string;

  @Field(() => Int, {
    description:
      'Decimal places in the currency. Every money value in this API is an integer in minor units: 19999 with minorUnits 2 is 199.99. A consumer that assumes 2 will be wrong for JPY.',
    deprecationReason: DEPRECATED_FOR_CHANNEL('currencyMinorUnits'),
  })
  @ApiProperty({
    example: 2,
    description:
      'Decimal places in the currency. Every money value in this API is an integer in minor units: 19999 with minorUnits 2 is 199.99. A consumer that assumes 2 will be wrong for JPY.',
    deprecated: true,
  })
  currencyMinorUnits!: number;

  @Field(() => TaxDisplay, {
    description:
      'How the engine applies tax for this tenant. Tenant-level until C-30 makes it charged per channel.',
  })
  @ApiProperty({ enum: TaxDisplay, example: TaxDisplay.EXCLUSIVE })
  taxDisplay!: TaxDisplay;

  @Field(() => Int, {
    description:
      'The tax rate checkout charges, in basis points: 875 is 8.75%. Tenant-level until C-38 makes a channel’s own rate the one charged.',
  })
  @ApiProperty({ example: 875, description: 'The tax rate checkout charges, in basis points.' })
  taxRateBps!: number;

  @Field(() => Boolean, {
    description:
      'False when this tenant has no pricing configuration yet, in which case currency and taxRateBps are platform defaults rather than real settings.',
  })
  @ApiProperty({
    description:
      'False when this tenant has no pricing configuration yet, in which case currency, locale and taxRateBps are platform defaults rather than real settings.',
  })
  configured!: boolean;

  @Field(() => String, {
    description: 'BCP-47 tag of the tenant default channel.',
    deprecationReason: DEPRECATED_FOR_CHANNEL('defaultLocale'),
  })
  @ApiProperty({ example: 'en-US', deprecated: true })
  defaultLocale!: string;

  @Field(() => [String], {
    description: 'BCP-47 tags the tenant default channel serves.',
    deprecationReason: DEPRECATED_FOR_CHANNEL('locales'),
  })
  @ApiProperty({ type: [String], example: ['en-US'], deprecated: true })
  locales!: string[];

  @Field(() => [CapabilityFeature])
  @ApiProperty({ type: [CapabilityFeature] })
  features!: CapabilityFeature[];
}

/**
 * Platform defaults, used when a tenant has no pricing config row. Reported
 * alongside `configured: false` so a consumer can tell a real setting from a
 * fallback instead of quietly trading in the wrong currency.
 */
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_TAX_RATE_BPS = 0;

/**
 * What this build implements. Honestly negative where the platform does not do
 * something — a `false` here is more useful to an integrator than an absent
 * key, because it distinguishes "not supported" from "you are talking to an
 * older version that never heard of this".
 *
 * These describe the deployment, not the tenant. Per-tenant toggles would flip
 * individual entries without changing the shape, which is why the response is a
 * list of keys rather than a fixed set of boolean fields.
 */
const FEATURES: ReadonlyArray<{ key: string; enabled: boolean }> = [
  { key: 'catalog.customAttributes', enabled: true },
  { key: 'search.faceted', enabled: true },
  { key: 'search.autocomplete', enabled: true },
  { key: 'search.sort', enabled: true },
  { key: 'cart.anonymous', enabled: true },
  { key: 'cart.coupon', enabled: true },
  { key: 'checkout.idempotent', enabled: true },
  { key: 'orders.snapshotIntegrity', enabled: true },
  { key: 'promotions.coupon', enabled: true },
  { key: 'promotions.automatic', enabled: true },
  { key: 'branding.perTenantTheme', enabled: true },
  // Deliberately unimplemented — see docs/CAVEATS.md and the ADRs.
  { key: 'customer.accounts', enabled: false },
  { key: 'customer.orderHistory', enabled: false },
  { key: 'catalog.multiCurrency', enabled: false },
  { key: 'i18n.multiLocale', enabled: false },
  { key: 'inventory.stockLevels', enabled: false },
  { key: 'shipping.rates', enabled: false },
  { key: 'payments.capture', enabled: false },
];

const API_VERSION = '0.1.0';

/**
 * Used only when a tenant has no config row yet — reported alongside
 * `configured: false` so a consumer can tell a real setting from a fallback.
 */
const FALLBACK_LOCALE = 'en-US';

/**
 * Builds the capability description. Both transports call this — the GraphQL
 * resolver and the REST controller below — so the two answers cannot drift
 * apart. A mirror maintained as a second implementation is a mirror that
 * eventually lies.
 */
@Injectable()
export class CapabilitiesService {
  constructor(
    @Inject(TENANT_CONFIG_QUERY) private readonly tenantConfig: ITenantConfigQuery,
    // The event-fed read-model: a warm channel is a map lookup, not a query.
    @Inject(CHANNEL_QUERY) private readonly channels: IChannelsQuery,
  ) {}

  async describe(): Promise<CapabilitiesType> {
    const { tenantId, channelId } = currentTenantOrThrow();
    const config = await this.tenantConfig.findOptional(tenantId);
    const channel = await requestChannel(this.channels, tenantId, channelId);
    // Asked separately only when the request named a channel; otherwise the
    // request's channel IS the default, and asking twice would be two reads.
    const tenantDefault = channelId
      ? await defaultChannelOrNull(this.channels, tenantId)
      : channel;
    const legacy = tenantDefault ? fromChannel(tenantDefault) : fromPricing(config);

    return {
      tenantId,
      apiVersion: API_VERSION,
      channel: channel ? fromChannel(channel) : null,
      currency: legacy.currency,
      currencyMinorUnits: legacy.currencyMinorUnits,
      // The engine adds tax on top of the discounted subtotal; C-29 taught it
      // gross, but nothing passes a mode to it until C-30. So this states how
      // money is computed today — it is not a per-tenant or per-channel setting.
      taxDisplay: TaxDisplay.EXCLUSIVE,
      // The price list's rate, because that is the one checkout charges. A
      // channel's own `taxRateBps` is configuration nothing charges yet (C-38).
      taxRateBps: config?.taxRateBps ?? DEFAULT_TAX_RATE_BPS,
      configured: config !== null,
      defaultLocale: legacy.defaultLocale,
      locales: legacy.locales,
      features: FEATURES.map((f) => ({ ...f })),
    };
  }
}

/** A resolved channel, as capabilities describe it. */
function fromChannel(channel: ChannelConfig): ChannelCapabilities {
  return {
    key: channel.key,
    name: channel.name,
    isDefault: channel.isDefault,
    currency: channel.currencyCode,
    currencyMinorUnits: channel.currencyMinorUnits,
    defaultLocale: channel.defaultLocale,
    locales: [...channel.supportedLocales],
    country: channel.country,
    timezone: channel.timezone,
  };
}

/**
 * The deprecated fields for a tenant with no channel at all — one created
 * after the C-11 backfill ran (C-35). Such a tenant predates channels in every
 * sense that matters, so it is described the way it was before them: from its
 * price list, or platform defaults alongside `configured: false`. Minor units
 * come from the currency itself, as they do for a channel; the hand-kept
 * table this replaced defaulted anything unlisted to 2, which is wrong for
 * JPY's neighbours and every three-decimal currency.
 */
function fromPricing(config: TenantConfig | null): {
  currency: string;
  currencyMinorUnits: number;
  defaultLocale: string;
  locales: string[];
} {
  const currency = config?.currency ?? DEFAULT_CURRENCY;
  const locale = config?.locale ?? FALLBACK_LOCALE;
  return {
    currency,
    currencyMinorUnits: minorUnitsFor(currency),
    defaultLocale: locale,
    locales: [locale],
  };
}

@Injectable()
@Resolver()
export class CapabilitiesResolver {
  constructor(private readonly service: CapabilitiesService) {}

  @Query(() => CapabilitiesType, { name: 'capabilities' })
  capabilities(): Promise<CapabilitiesType> {
    return this.service.describe();
  }
}

/**
 * REST mirror of `Query.capabilities`.
 *
 * The point of a self-description endpoint is that a consumer nobody here
 * wrote can configure itself, and plenty of those consumers do not speak
 * GraphQL — a mobile client, a partner integration, or the ICM-style facade
 * sketched in ADR-0013, which would read exactly this at boot. Offering
 * self-description only over the transport our own storefront happens to use
 * would have missed most of the audience the endpoint exists for.
 *
 * Tenant-scoped like everything else: it goes through the tenant middleware
 * and answers for whoever `x-tenant-id` names.
 */
@ApiTags('System')
@Controller('system/capabilities')
export class CapabilitiesController {
  constructor(private readonly service: CapabilitiesService) {}

  @Get()
  @ApiOperation({
    summary: 'What this API supports for the calling tenant',
    description:
      'Currency and its minor-unit exponent, locale, tax display mode and rate, and a feature map. Identical data to the GraphQL `capabilities` query — both are served by one implementation.',
  })
  @ApiOkResponse({ type: CapabilitiesType })
  get(): Promise<CapabilitiesType> {
    return this.service.describe();
  }
}

@Module({
  providers: [CapabilitiesService, CapabilitiesResolver],
  controllers: [CapabilitiesController],
})
export class CapabilitiesModule {}
