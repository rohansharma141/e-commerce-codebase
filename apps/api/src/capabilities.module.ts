import { Field, Int, ObjectType, Query, Resolver, registerEnumType } from '@nestjs/graphql';
import { Inject, Injectable, Module } from '@nestjs/common';
import {
  TENANT_CONFIG_QUERY,
  type ITenantConfigQuery,
} from '@platform/modules/pricing/contracts';
import { currentTenantOrThrow } from '@platform/shared/tenant-context';

/**
 * `Query.capabilities` — the API describing itself.
 *
 * Every other endpoint answers a question about a tenant's data. This one
 * answers questions about the API: what currency this tenant trades in, how
 * many minor units that currency has, whether tax is added at checkout or
 * already in the listed price, which locales are supported, and which
 * capabilities this deployment actually implements.
 *
 * Why it exists: the platform is sold as a standalone product, and until now a
 * consumer had no way to discover any of that. Our own storefront papers over
 * the gap by hardcoding `en-US`, a `$` prefix and two decimal places — which
 * only works because the same author wrote both sides. Anyone else integrating
 * has to be told out of band, and out of band is how integrations drift. A
 * headless product that cannot describe itself is incomplete regardless of how
 * many features it has.
 *
 * Lives in the composition root rather than a domain module on purpose.
 * Capabilities are a property of the assembled deployment — which modules are
 * wired in, what this build supports — and no single domain module knows that.
 * Putting it in `pricing` because that happens to be where currency is stored
 * would repeat the mistake documented for branding in CAVEATS.md.
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

@ObjectType({ description: 'A named capability of this deployment.' })
export class CapabilityFeature {
  @Field(() => String, { description: 'Stable dotted key, e.g. promotions.coupon' })
  key!: string;

  @Field(() => Boolean)
  enabled!: boolean;
}

@ObjectType({ description: 'What this API supports, for the calling tenant.' })
export class CapabilitiesType {
  @Field(() => String)
  tenantId!: string;

  @Field(() => String, { description: 'Version of the platform serving this request.' })
  apiVersion!: string;

  @Field(() => String, { description: 'ISO 4217 code this tenant trades in.' })
  currency!: string;

  @Field(() => Int, {
    description:
      'Decimal places in the currency. Every money value in this API is an integer in minor units: 19999 with minorUnits 2 is 199.99. A consumer that assumes 2 will be wrong for JPY.',
  })
  currencyMinorUnits!: number;

  @Field(() => TaxDisplay)
  taxDisplay!: TaxDisplay;

  @Field(() => Int, { description: 'Tax rate in basis points. 875 is 8.75%.' })
  taxRateBps!: number;

  @Field(() => Boolean, {
    description:
      'False when this tenant has no pricing configuration yet, in which case currency and taxRateBps are platform defaults rather than real settings.',
  })
  configured!: boolean;

  @Field(() => String)
  defaultLocale!: string;

  @Field(() => [String], { description: 'BCP-47 tags this deployment can serve.' })
  locales!: string[];

  @Field(() => [CapabilityFeature])
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
 * Minor units per ISO 4217. Only currencies this deployment has actually been
 * exercised with are listed; anything else falls back to 2, which is right for
 * the large majority and wrong in a way the consumer can detect, because the
 * currency code sits right next to it.
 */
const MINOR_UNITS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  JPY: 0,
};

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
const DEFAULT_LOCALE = 'en-US';

@Injectable()
@Resolver()
export class CapabilitiesResolver {
  constructor(
    @Inject(TENANT_CONFIG_QUERY) private readonly tenantConfig: ITenantConfigQuery,
  ) {}

  @Query(() => CapabilitiesType, { name: 'capabilities' })
  async capabilities(): Promise<CapabilitiesType> {
    const tenant = currentTenantOrThrow();
    const config = await this.tenantConfig.findOptional(tenant.tenantId);
    const currency = config?.currency ?? DEFAULT_CURRENCY;

    return {
      tenantId: tenant.tenantId,
      apiVersion: API_VERSION,
      currency,
      currencyMinorUnits: MINOR_UNITS[currency] ?? 2,
      // Totals add tax on top of the discounted subtotal rather than deriving
      // it out of a tax-inclusive price, so this states how the pricing engine
      // works — it is not a per-tenant setting.
      taxDisplay: TaxDisplay.EXCLUSIVE,
      taxRateBps: config?.taxRateBps ?? DEFAULT_TAX_RATE_BPS,
      configured: config !== null,
      defaultLocale: DEFAULT_LOCALE,
      // One entry, honestly. The platform has no i18n; advertising more would
      // be inventing a capability.
      locales: [DEFAULT_LOCALE],
      features: FEATURES.map((f) => ({ ...f })),
    };
  }
}

@Module({
  providers: [CapabilitiesResolver],
})
export class CapabilitiesModule {}
