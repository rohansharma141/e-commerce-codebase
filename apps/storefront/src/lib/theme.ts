import 'server-only';
import { TenantThemeDocument, type TenantThemeQuery } from '@platform/api-client';
import { GraphqlError, graphqlQuery } from './api-graphql';
import { ApiError } from './api-rest';
import { getTenantId } from './tenant';

type Theme = TenantThemeQuery['theme'];

/**
 * The frame's last resort, used only when the api refuses every read (C-19d).
 *
 * A tenant whose *default* channel is unservable has no channel to read
 * anything in, the theme included — even the discovery call is refused. The
 * frame has to render anyway, because the message inside it is the one thing
 * worth saying. Neutral on purpose: it is not a brand, it is the absence of
 * one, and a wrong brand would be worse than none.
 */
const FALLBACK_THEME: Theme = {
  brandName: 'Store',
  tagline: '',
  logoMark: '◆',
  brandHsl: '222 47% 31%',
  brandFgHsl: '0 0% 100%',
  pageBgHsl: '0 0% 100%',
  pageFgHsl: '222 15% 20%',
  fontSans: 'ui-sans-serif, system-ui, sans-serif',
};

interface ThemeOptions {
  /** Read in the tenant's default channel — see `graphqlQuery`. */
  inDefaultChannel?: boolean;
  /** Return `FALLBACK_THEME` if the api refuses the read, instead of throwing. */
  fallbackOnRefusal?: boolean;
}

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
export async function getTenantTheme(options: ThemeOptions = {}): Promise<Theme> {
  const tenantId = getTenantId();
  try {
    const data = await graphqlQuery(
      TenantThemeDocument,
      {},
      { tags: [`theme:${tenantId}`], inDefaultChannel: options.inDefaultChannel },
    );
    return data.theme;
  } catch (err) {
    const status = err instanceof GraphqlError || err instanceof ApiError ? err.status : undefined;
    if (options.fallbackOnRefusal && status === 422) return FALLBACK_THEME;
    throw err;
  }
}
