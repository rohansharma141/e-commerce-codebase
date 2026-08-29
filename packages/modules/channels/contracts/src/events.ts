import type { Channel, ChannelConfig, TenantDefaults } from './channel.dto';

/**
 * Channel domain events.
 *
 * Module-prefixed like every other event on the bus (`catalog.*`, `pricing.*`,
 * `search.*`, `orders.*`), and network-strict: plain serializable objects
 * carrying everything a consumer needs, so no subscriber has to call back into
 * `channels` to make sense of one. Written as if they already cross a network,
 * because they will if this module is ever extracted.
 *
 * ── Why the payload carries the resolved config, not just the row ─────────
 *
 * Consuming modules hold a local read-model of channel configuration and are
 * forbidden from querying `channels` per write (ADR-0014 §3) — a cross-module
 * synchronous read on the write path is both a boundary violation and a
 * latency multiplier. For that replication to work, the event has to be
 * sufficient on its own. A consumer that received only `Channel` would have to
 * fetch tenant defaults to resolve inheritance, which is the call this design
 * exists to avoid.
 *
 * ── Why tenant-defaults gets its own event ────────────────────────────────
 *
 * A change to `TenantDefaults` changes the resolved config of every channel
 * that inherits the edited field — potentially all of them. Emitting one
 * `channels.updated` per affected channel would be a thundering herd on a
 * single operator edit, so it is published once and consumers invalidate that
 * tenant's entries wholesale.
 */
export const CHANNELS_EVENTS = {
  Created: 'channels.created',
  Updated: 'channels.updated',
  Archived: 'channels.archived',
  DefaultChanged: 'channels.default-changed',
  TenantDefaultsUpdated: 'channels.tenant-defaults.updated',
} as const;

export type ChannelsEventName = (typeof CHANNELS_EVENTS)[keyof typeof CHANNELS_EVENTS];

export interface ChannelCreatedPayload {
  readonly channel: Channel;
  /** Resolved, so a consumer can populate its read-model without a follow-up. */
  readonly config: ChannelConfig;
}

export interface ChannelUpdatedPayload {
  readonly channel: Channel;
  readonly config: ChannelConfig;
  /**
   * Which fields this write actually changed.
   *
   * Consumers invalidate at different granularities: a rename touches display
   * caches, a currency change invalidates every price ever rendered for the
   * channel. Without this a consumer must diff against state it may not hold,
   * and would conservatively invalidate everything on every edit. An empty
   * array means a no-op write, which is worth being able to see rather than
   * inferring from values that happen to match.
   */
  readonly changed: readonly (keyof Channel)[];
}

export interface ChannelArchivedPayload {
  readonly channelId: string;
  readonly tenantId: string;
  /**
   * Carried alongside the id because consumers key their read-models and cache
   * tags on the key, and an archived channel must be evictable without a
   * lookup against a module that has just stopped serving it.
   */
  readonly key: string;
}

export interface ChannelDefaultChangedPayload {
  readonly tenantId: string;
  readonly newDefaultChannelId: string;
  readonly newDefaultKey: string;
  /** Null only for a tenant's first channel, which becomes default on creation. */
  readonly previousDefaultChannelId: string | null;
}

export interface TenantDefaultsUpdatedPayload {
  readonly defaults: TenantDefaults;
  /**
   * Which default fields actually changed. A consumer holding resolved configs
   * can skip invalidation entirely when the edit touched nothing it inherited —
   * and, more importantly, an empty array here means a no-op write, which is
   * worth being able to see rather than inferring from unchanged values.
   */
  readonly changedFields: readonly (keyof TenantDefaults)[];
}
