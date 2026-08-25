import 'server-only';
import { TenantCapabilitiesDocument } from '@platform/api-client';
import { graphqlQuery } from './api-graphql';
import { getTenantId } from './tenant';
import type { MoneyFormat } from './money';

/**
 * What the api says it supports for this tenant.
 *
 * Tagged `capabilities:<tenantId>` so a `pricing.tenant-config.updated`
 * webhook drops it — a tenant switching currency has to reach rendered pages,
 * not wait out the hour-long fallback, because every price on the site is
 * wrong in the meantime.
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
    { tags: [`capabilities:${tenantId}`] },
  );
  const caps = data.capabilities;
  return {
    currency: caps.currency,
    minorUnits: caps.currencyMinorUnits,
    locale: caps.defaultLocale,
  };
}
