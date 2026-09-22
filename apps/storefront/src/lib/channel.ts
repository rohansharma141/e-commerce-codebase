import 'server-only';
import { notFound } from 'next/navigation';
import { TenantCapabilitiesDocument } from '@platform/api-client';
import { GraphqlError, graphqlQuery } from './api-graphql';
import { capabilitiesTag } from './cache-tags';
import { getChannelKey } from './channel-key';
import { withChannelPrefix } from './channel-path';
import { getTenantId } from './tenant';

export { getChannelKey } from './channel-key';

/** A storefront path under the current request's channel prefix. */
export function channelHref(path: string): string {
  return withChannelPrefix(getChannelKey(), path);
}

export interface StorefrontChannel {
  key: string;
  name: string;
  isDefault: boolean;
}

/**
 * `found: false` only when the path named a channel the api does not know.
 * `channel` is null for a tenant with no channel at all, which the api reports
 * as `channel: null` rather than an error.
 */
export type ChannelLookup = { found: true; channel: StorefrontChannel | null } | { found: false };

/**
 * Asks the api which channel serves this request, and whether the one the
 * path named exists at all. An unknown, archived or other-tenant key is a
 * `404` from the api; anything else it refuses is rethrown.
 *
 * Only `200`s enter Next's data cache (`patch-fetch.js` checks the status
 * before storing), so a `404` is asked again on every request and a channel
 * created a moment ago is reachable at once.
 *
 * For the root layout, which must render even for an unknown channel: it is
 * the frame the `404` page is drawn in. Pages go through `resolveChannel`.
 */
export async function lookupChannel(): Promise<ChannelLookup> {
  const tenantId = getTenantId();
  try {
    // The same document and tag as `getMoneyFormat`, and both read in the
    // request's channel, so the two are one memoised fetch.
    const data = await graphqlQuery(TenantCapabilitiesDocument, {}, {
      tags: [capabilitiesTag(tenantId)],
    });
    return { found: true, channel: data.capabilities.channel ?? null };
  } catch (err) {
    // Only a key the *path* named can be unknown. The default's key came from
    // the api a moment ago; a 404 for it is a fault, not a missing page.
    if (getChannelKey() && err instanceof GraphqlError && err.status === 404) {
      return { found: false };
    }
    throw err;
  }
}

/**
 * The request's channel, or the storefront's `404` if the path named one the
 * api does not know — never the default channel. Serving the default under a
 * prefix nobody configured would make a typo look like a working market, and
 * give every mistyped link a second copy of the default's pages.
 */
export async function resolveChannel(): Promise<StorefrontChannel | null> {
  const lookup = await lookupChannel();
  if (!lookup.found) notFound();
  return lookup.channel;
}
