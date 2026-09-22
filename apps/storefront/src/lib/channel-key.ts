import 'server-only';
import { headers } from 'next/headers';
import type { Capabilities } from '@platform/api-client';
import { ApiError } from './api-rest';
import { capabilitiesTag } from './cache-tags';
import { CHANNEL_KEY_HEADER } from './channel-path';
import { getTenantId } from './tenant';

const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://localhost:3000';

/**
 * The channel the path named (C-19a), or null for an unprefixed path.
 *
 * This is the key for *links*: an unprefixed page links unprefixed, even
 * though its reads name the default channel by key. For the key every api
 * call names, use `requestChannelKey`.
 */
export function getChannelKey(): string | null {
  return headers().get(CHANNEL_KEY_HEADER) || null;
}

/**
 * The channel every api call names (C-19b).
 *
 * The path's key when it has one. Otherwise the tenant default's key, learned
 * from `GET /system/capabilities` — the one read the api answers without a
 * channel, kept unscoped as a discovery point because discovery cannot require
 * what it discovers (ADR-0014 §2, amended). Naming the default by key rather
 * than by omission is what lets the api stop treating an absent channel as the
 * default (C-42) without breaking this storefront.
 *
 * The answer is cached under the capabilities tag, which the webhook drops on
 * `channels.default-changed`, so a new default reaches unprefixed pages
 * without waiting out the hourly fallback.
 *
 * Null only for a tenant with no channel at all. Its reads go unscoped, which
 * the api answers from the tenant's price list until C-42 refuses them; C-35
 * makes such tenants impossible to create.
 */
export async function requestChannelKey(): Promise<string | null> {
  return getChannelKey() ?? (await defaultChannelKey());
}

/**
 * The tenant default's key, whatever the path named. `requestChannelKey` is
 * the one to use; this is for the frame of an unknown channel's `404` (see
 * `graphqlQuery`'s `inDefaultChannel`).
 */
export async function defaultChannelKey(): Promise<string | null> {
  const tenantId = getTenantId();
  const path = '/system/capabilities';
  const res = await fetch(`${API_ORIGIN}${path}`, {
    headers: { 'x-tenant-id': tenantId },
    next: { tags: [capabilitiesTag(tenantId)], revalidate: 3600 },
  });
  if (!res.ok) {
    // A 422 here is the default channel itself being unservable (C-32b): the
    // whole unprefixed storefront is refused, and C-19d renders that.
    throw new ApiError(res.status, path, await res.text().catch(() => ''));
  }
  const body = (await res.json()) as Capabilities;
  return body.channel?.key ?? null;
}
