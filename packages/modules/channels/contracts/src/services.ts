import type {
  Channel,
  ChannelConfig,
  CreateChannelDto,
  ResolvedChannel,
  TenantDefaults,
  UpdateChannelDto,
  UpdateTenantDefaultsDto,
} from './channel.dto';

/**
 * The channels module's public interface.
 *
 * Split in two deliberately. `IChannelsQuery` is the narrow read surface other
 * modules depend on; `ChannelsAdmin` is the write surface only the admin
 * controllers and back office use. A consuming module that needs to resolve a
 * channel should depend on the query interface alone, so nothing accidentally
 * acquires the ability to archive a market on a read path.
 *
 * This mirrors `IPricesQuery` / `IPromotionsQuery` in the pricing contracts.
 */

export interface IChannelsQuery {
  /**
   * Resolve a channel by key within a tenant.
   *
   * Returns null for unknown, archived **and** cross-tenant keys — the caller
   * turns that into a `404` and must never fall back to the default. Silent
   * fallback means a typo serves a different market's prices and looks like it
   * worked. Archived is grouped with unknown on purpose: a closed market should
   * stop resolving, not degrade to a working one.
   */
  findByKey(tenantId: string, key: string): Promise<ChannelConfig | null>;

  findById(tenantId: string, channelId: string): Promise<ChannelConfig | null>;

  /**
   * The tenant's default channel, used when a request carries no channel scope.
   *
   * Every tenant has exactly one, guaranteed by a partial unique index plus the
   * repository invariant that it must be active and cannot be archived.
   */
  findDefault(tenantId: string): Promise<ChannelConfig>;

  /** Active channels only. The back office lists drafts and archives separately. */
  listActive(tenantId: string): Promise<readonly ChannelConfig[]>;
}

export interface ChannelsAdmin {
  /** Includes drafts and archived — this is the management view. */
  list(tenantId: string): Promise<readonly ResolvedChannel[]>;

  get(tenantId: string, channelId: string): Promise<ResolvedChannel | null>;

  create(tenantId: string, dto: CreateChannelDto): Promise<Channel>;

  /**
   * `expectedVersion` is required, not optional.
   *
   * Optional optimistic concurrency is no optimistic concurrency: the one
   * caller that omits it is the one that silently overwrites another operator's
   * edit, and that caller is invisible until two people use the console at
   * once. Mismatch is a `409` carrying the current version.
   */
  update(
    tenantId: string,
    channelId: string,
    dto: UpdateChannelDto,
    expectedVersion: number,
  ): Promise<Channel>;

  /** Rejected for the default channel — promote another first. */
  archive(tenantId: string, channelId: string, expectedVersion: number): Promise<Channel>;

  /**
   * Promote a channel to default. Two writes (unset the old, set the new)
   * racing a partial unique index, so implementations must do it in one
   * transaction in a deterministic order — otherwise the failure mode is an
   * intermittent constraint violation that appears in production and nowhere
   * else.
   */
  promoteDefault(tenantId: string, channelId: string): Promise<Channel>;

  getTenantDefaults(tenantId: string): Promise<TenantDefaults>;

  updateTenantDefaults(
    tenantId: string,
    dto: UpdateTenantDefaultsDto,
    expectedVersion: number,
  ): Promise<TenantDefaults>;
}
