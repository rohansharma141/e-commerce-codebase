import 'server-only';
import { TenantThemeDocument } from '@platform/api-client';
import { graphqlQuery } from './api-graphql';
import { getTenantId } from './tenant';

/**
 * Per-tenant theme fetcher. Tagged `theme:<tenantId>` so a future
 * tenant.config.updated webhook can invalidate without nuking unrelated
 * caches. Fallback to a 1-hour revalidate covers stale state if the
 * webhook is dropped.
 *
 * Returns a fully-populated theme — the api's resolver fills DEFAULT_THEME
 * for any missing field, so the storefront layout can use the return value
 * without itself fallback logic.
 */
export async function getTenantTheme() {
  const tenantId = getTenantId();
  const data = await graphqlQuery(
    TenantThemeDocument,
    {},
    { tags: [`theme:${tenantId}`] },
  );
  return data.theme;
}
