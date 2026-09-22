import {
  NoDefaultChannelError,
  type ChannelConfig,
  type IChannelsQuery,
} from '@platform/modules/channels/contracts';

/**
 * The composition root's two questions about channels, answered once.
 *
 * Both the servability check (C-32b) and capabilities (C-18) need "which
 * channel is this request in?" and "which is the tenant's default?", with the
 * same answer for a tenant that has no channel at all. Two copies of that
 * answer would drift — one of them treating a missing default as an error and
 * the other as "pass" — so it lives here.
 */

/**
 * The tenant's default channel, or `null` when it has none.
 *
 * Only `NoDefaultChannelError` means "none". Any other failure — a database
 * error, say — propagates, rather than being mistaken for a tenant that
 * predates channels.
 */
export async function defaultChannelOrNull(
  channels: IChannelsQuery,
  tenantId: string,
): Promise<ChannelConfig | null> {
  try {
    return await channels.findDefault(tenantId);
  } catch (err) {
    if (err instanceof NoDefaultChannelError) return null;
    throw err;
  }
}

/**
 * The channel a request is in: the one it named (bound by
 * ChannelScopeMiddleware), else the tenant default, else `null`.
 *
 * A named channel that stopped resolving between being bound and being asked
 * about also yields `null`; the caller decides what that means.
 */
export function requestChannel(
  channels: IChannelsQuery,
  tenantId: string,
  channelId: string | undefined,
): Promise<ChannelConfig | null> {
  return channelId
    ? channels.findById(tenantId, channelId)
    : defaultChannelOrNull(channels, tenantId);
}
