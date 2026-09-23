import 'server-only';
import { TenantCapabilitiesDocument } from '@platform/api-client';
import { GraphqlError, graphqlQuery } from './api-graphql';
import { ApiError } from './api-rest';
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
 * What the api says about the channel this request names.
 *
 *   ok          — it serves. `channel` is null only for a tenant with no
 *                 channel at all, which the api reports as `channel: null`
 *                 rather than an error.
 *   unknown     — the path named a key the api does not have: unknown,
 *                 archived, or another tenant's. Its `404`.
 *   unservable  — the channel exists but the price list cannot serve its
 *                 currency, so the api refuses every storefront request in it
 *                 (C-32b). Its `422`.
 */
export type ChannelLookup =
  | { status: 'ok'; channel: StorefrontChannel | null }
  | { status: 'unknown' }
  | { status: 'unservable' };

/**
 * Asks the api which channel serves this request, and how it answers for it.
 * Anything refused for another reason is rethrown: a fault must not read as a
 * closed market.
 *
 * Only `200`s enter Next's data cache (`patch-fetch.js` checks the status
 * before storing), so a refusal is asked again on every request — a channel
 * created, or made servable, a moment ago is reachable at once.
 *
 * Both layouts call this: the root one to draw its frame, `(shop)` to decide
 * whether a page renders at all.
 */
export async function lookupChannel(): Promise<ChannelLookup> {
  const tenantId = getTenantId();
  try {
    // The same document and tag as `getMoneyFormat`, and both read in the
    // request's channel, so the two are one memoised fetch.
    const data = await graphqlQuery(TenantCapabilitiesDocument, {}, {
      tags: [capabilitiesTag(tenantId)],
    });
    return { status: 'ok', channel: data.capabilities.channel ?? null };
  } catch (err) {
    // Only a key the *path* named can be unknown. The default's key came from
    // the api a moment ago; a 404 for it is a fault, not a missing page.
    if (getChannelKey() && statusOf(err) === 404) return { status: 'unknown' };
    // 422 reaches here two ways: the capabilities read refused in a named
    // channel, or — on an unprefixed page whose default is unservable — the
    // discovery call itself, which fails as an ApiError before any query runs.
    if (statusOf(err) === 422) return { status: 'unservable' };
    throw err;
  }
}

function statusOf(err: unknown): number | undefined {
  if (err instanceof GraphqlError) return err.status;
  if (err instanceof ApiError) return err.status;
  return undefined;
}
