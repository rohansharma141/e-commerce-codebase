import 'server-only';
import { TenantCapabilitiesDocument } from '@platform/api-client';
import { graphqlQuery } from './api-graphql';
import { capabilitiesTag } from './cache-tags';
import { getTenantId } from './tenant';
import type { MoneyFormat } from './money';

/**
 * What the api says it supports for this request's channel.
 *
 * Tagged `capabilities:<tenantId>` so the webhook drops it on anything that
 * can change it — `pricing.tenant-config.updated`, and since C-18a the channel
 * edits, because capabilities are now composed from channels. A currency or
 * locale change has to reach rendered pages, not wait out the hour-long
 * fallback, because every price on the site is wrong in the meantime.
 *
 * Fetched per render rather than read from an env var or a constant on
 * purpose. The whole point of the endpoint is that a consumer discovers this
 * instead of being configured with it; a storefront that cached it at build
 * time would be back to hardcoding, just less visibly.
 */
export async function getMoneyFormat(): Promise<MoneyFormat> {
  const tenantId = getTenantId();
  const data = await graphqlQuery(
    TenantCapabilitiesDocument,
    {},
    { tags: [capabilitiesTag(tenantId)] },
  );
  // The channel's own answer (C-19b). The tenant-level fields are deprecated
  // aliases that answer for the default channel whatever the request named
  // (ADR-0014 §7), so on `/trade` they would format with `uk`'s locale. They
  // are read only for a tenant with no channel at all, which the api describes
  // from its price list; C-19c removes them.
  const caps = data.capabilities;
  const source = caps.channel ?? caps;
  return {
    currency: source.currency,
    minorUnits: source.currencyMinorUnits,
    locale: source.defaultLocale,
  };
}
