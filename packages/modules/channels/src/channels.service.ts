import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventBus } from '@platform/shared/event-bus';
import {
  CHANNELS_EVENTS,
  assertChannelValid,
  resolveChannelConfig,
  validateChannelCreate,
  validateChannelUpdate,
  validatePromoteDefault,
  ChannelInvariantError,
  type Channel,
  type ChannelConfig,
  type ChannelsAdmin,
  type CreateChannelDto,
  type IChannelsQuery,
  type ResolvedChannel,
  type TenantDefaults,
  type UpdateChannelDto,
  type UpdateTenantDefaultsDto,
} from '@platform/modules/channels/contracts';
import { ChannelsRepository, VersionConflictError } from './channels.repository';

/**
 * The channels module's behaviour: invariants, then persistence.
 *
 * The split is deliberate and matches the rest of the platform. The repository
 * owns SQL and nothing else. C-8a's predicates own the rules and are pure. This
 * service is the only place that composes them, which is what stops a rule
 * being enforced on one path and not another — the failure mode where a channel
 * created through the admin API is validated and one created by the seed is not.
 *
 * It also owns the mapping from domain failure to HTTP status, because that
 * choice is a property of the operation rather than of the storage:
 *
 *   - an invariant violation → `400`, with every violation reported, not just
 *     the first (the back office edits a whole channel in one form)
 *   - a version conflict     → `409`, carrying the current version so a client
 *     can re-read and retry without a second round trip
 *   - a missing channel      → `404`
 */

/**
 * The persistence port.
 *
 * Declared here rather than the service depending on `ChannelsRepository`
 * directly, so the invariant logic can be tested against an in-memory fake.
 * That matters more than usual right now: the repository's SQL has never run
 * against a database, and without this seam the guards below would inherit that
 * uncertainty instead of being independently checkable.
 */
export interface ChannelStore {
  findTenantDefaults(tenantId: string): Promise<TenantDefaults | null>;
  updateTenantDefaults(
    tenantId: string,
    dto: UpdateTenantDefaultsDto,
    expectedVersion: number,
  ): Promise<TenantDefaults>;
  findByKey(tenantId: string, key: string): Promise<ChannelConfig | null>;
  findById(tenantId: string, channelId: string): Promise<ChannelConfig | null>;
  findDefault(tenantId: string): Promise<ChannelConfig>;
  listActive(tenantId: string): Promise<readonly ChannelConfig[]>;
  list(tenantId: string): Promise<readonly ResolvedChannel[]>;
  listPage(
    tenantId: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<{ items: readonly ResolvedChannel[]; nextCursor: string | null }>;
  get(tenantId: string, channelId: string): Promise<ResolvedChannel | null>;
  getRaw(tenantId: string, channelId: string): Promise<Channel | null>;
  countActive(tenantId: string): Promise<number>;
  create(tenantId: string, dto: CreateChannelDto): Promise<Channel>;
  update(
    tenantId: string,
    channelId: string,
    dto: UpdateChannelDto & { readonly key?: string },
    expectedVersion: number,
  ): Promise<Channel>;
  promoteDefault(tenantId: string, channelId: string): Promise<Channel>;
}

@Injectable()
export class ChannelsService implements IChannelsQuery, ChannelsAdmin {
  constructor(
    @Inject(ChannelsRepository) private readonly store: ChannelStore,
    private readonly events: EventBus,
  ) {}

  /**
   * Publishes after the write has committed, never before.
   *
   * A consumer that receives `channels.created` and immediately reads through
   * (C-14) must find the row. Publishing inside the write would let a rollback
   * leave subscribers holding a channel that does not exist -- and the
   * in-process bus makes that ordering easy to get wrong precisely because it
   * feels synchronous.
   */
  private async emit(name: string, tenantId: string, payload: unknown): Promise<void> {
    await this.events.publish({
      name,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      payload: payload as never,
    });
  }

  /**
   * The resolved config that rides along on every channel event.
   *
   * Resolved rather than stored, so a consumer never has to ask this module
   * what a `null` meant -- the follow-up read ADR-0014 §3 rules out.
   */
  private async resolved(tenantId: string, channel: Channel): Promise<ChannelConfig> {
    const defaults = await this.store.findTenantDefaults(tenantId);
    if (!defaults) throw new NotFoundException(`no channel configuration for ${tenantId}`);
    return resolveChannelConfig(channel, defaults).config;
  }

  // ── reads ───────────────────────────────────────────────────────────────

  findByKey(tenantId: string, key: string): Promise<ChannelConfig | null> {
    return this.store.findByKey(tenantId, key);
  }

  findById(tenantId: string, channelId: string): Promise<ChannelConfig | null> {
    return this.store.findById(tenantId, channelId);
  }

  findDefault(tenantId: string): Promise<ChannelConfig> {
    return this.store.findDefault(tenantId);
  }

  listActive(tenantId: string): Promise<readonly ChannelConfig[]> {
    return this.store.listActive(tenantId);
  }

  list(tenantId: string): Promise<readonly ResolvedChannel[]> {
    return this.store.list(tenantId);
  }

  listPage(
    tenantId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: readonly ResolvedChannel[]; nextCursor: string | null }> {
    return this.store.listPage(tenantId, opts);
  }

  get(tenantId: string, channelId: string): Promise<ResolvedChannel | null> {
    return this.store.get(tenantId, channelId);
  }

  getTenantDefaults(tenantId: string): Promise<TenantDefaults> {
    return this.requireDefaults(tenantId);
  }

  /**
   * The stored version, for an `ETag` on a read.
   *
   * `ResolvedChannel` deliberately does not carry it: version belongs to the
   * stored row, and putting it on the resolved config would invite a client to
   * treat a resolved view as something it can write back.
   */
  async getRawVersion(tenantId: string, channelId: string): Promise<number | null> {
    return (await this.store.getRaw(tenantId, channelId))?.version ?? null;
  }

  // ── writes ──────────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateChannelDto): Promise<Channel> {
    await this.rejecting(async () =>
      validateChannelCreate(tenantId, dto, await this.context(tenantId)),
    );
    const created = await this.store.create(tenantId, dto);
    await this.emit(CHANNELS_EVENTS.Created, tenantId, {
      channel: created,
      config: await this.resolved(tenantId, created),
    });
    return created;
  }

  async update(
    tenantId: string,
    channelId: string,
    dto: UpdateChannelDto & { readonly key?: string },
    expectedVersion: number,
  ): Promise<Channel> {
    const current = await this.require(tenantId, channelId);
    await this.rejecting(async () =>
      validateChannelUpdate(current, dto, await this.context(tenantId)),
    );
    const updated = await this.persist(() =>
      this.store.update(tenantId, channelId, dto, expectedVersion),
    );

    // `changed` is computed by diffing the stored row before and after, not by
    // trusting the caller's patch: a PATCH may name a field and set it to the
    // value it already had, and reporting that as a change would invalidate
    // caches for a write that moved nothing.
    const changed = (Object.keys(dto) as (keyof Channel)[]).filter(
      (k) => k in current && current[k] !== updated[k],
    );

    // Archival is its own event. A consumer subscribed only to `updated` would
    // keep resolving a closed market, so the distinction is a separate name
    // rather than a field someone has to remember to branch on.
    if (updated.status === 'archived' && current.status !== 'archived') {
      await this.emit(CHANNELS_EVENTS.Archived, tenantId, {
        channelId: updated.id,
        tenantId,
        key: updated.key,
      });
      return updated;
    }

    await this.emit(CHANNELS_EVENTS.Updated, tenantId, {
      channel: updated,
      config: await this.resolved(tenantId, updated),
      changed,
    });
    return updated;
  }

  /**
   * Archiving is an update with `status: 'archived'`, not a separate rule path.
   *
   * Routing it through the same validator is what guarantees the default-channel
   * and last-active-channel checks apply however a channel is archived — via
   * this method, or via a plain `update` that happens to set the status.
   */
  archive(tenantId: string, channelId: string, expectedVersion: number): Promise<Channel> {
    return this.update(tenantId, channelId, { status: 'archived' }, expectedVersion);
  }

  async promoteDefault(tenantId: string, channelId: string): Promise<Channel> {
    const candidate = await this.require(tenantId, channelId);
    await this.rejecting(async () => validatePromoteDefault(candidate));
    const previous = (await this.store.list(tenantId)).find((c) => c.config.isDefault);
    const promoted = await this.store.promoteDefault(tenantId, channelId);
    await this.emit(CHANNELS_EVENTS.DefaultChanged, tenantId, {
      tenantId,
      newDefaultChannelId: promoted.id,
      newDefaultKey: promoted.key,
      // Null only for a tenant's first channel. Read before the promotion, or
      // it would report the channel that just won.
      previousDefaultChannelId: previous?.config.channelId ?? null,
    });
    return promoted;
  }

  async updateTenantDefaults(
    tenantId: string,
    dto: UpdateTenantDefaultsDto,
    expectedVersion: number,
  ): Promise<TenantDefaults> {
    const before = await this.requireDefaults(tenantId);
    const after = await this.persist(() =>
      this.store.updateTenantDefaults(tenantId, dto, expectedVersion),
    );

    const changedFields = (Object.keys(dto) as (keyof TenantDefaults)[]).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );

    // One event for the tenant, not one per affected channel. A defaults edit
    // can move the resolved config of every channel that inherits the field, so
    // fanning out per channel would be a thundering herd on a single operator
    // click. Consumers invalidate that tenant's entries wholesale.
    await this.emit(CHANNELS_EVENTS.TenantDefaultsUpdated, tenantId, {
      defaults: after,
      changedFields,
    });
    return after;
  }

  // ── plumbing ────────────────────────────────────────────────────────────

  /**
   * `activeChannelCount` is read per write rather than cached.
   *
   * The last-active-channel rule is a decision about the tenant's current
   * state, and a stale count is the difference between refusing a valid archive
   * and permitting one that strands the tenant with nothing to resolve.
   */
  private async context(tenantId: string): Promise<{ activeChannelCount: number }> {
    return { activeChannelCount: await this.store.countActive(tenantId) };
  }

  private async require(tenantId: string, channelId: string): Promise<Channel> {
    const current = await this.store.getRaw(tenantId, channelId);
    // Cross-tenant is indistinguishable from missing here, and that is correct:
    // RLS never returned the row, and saying "forbidden" would confirm it
    // exists.
    if (!current) throw new NotFoundException(`no channel ${channelId}`);
    return current;
  }

  private async requireDefaults(tenantId: string): Promise<TenantDefaults> {
    const defaults = await this.store.findTenantDefaults(tenantId);
    if (!defaults) throw new NotFoundException(`no channel configuration for ${tenantId}`);
    return defaults;
  }

  /** Runs a validator and turns any violations into a 400 listing all of them. */
  private async rejecting(
    validate: () => Promise<readonly import('@platform/modules/channels/contracts').ChannelViolation[]>,
  ): Promise<void> {
    try {
      assertChannelValid(await validate());
    } catch (e) {
      if (e instanceof ChannelInvariantError) {
        throw new BadRequestException({
          message: e.violations.map((v) => v.message),
          error: 'Bad Request',
          statusCode: 400,
          violations: e.violations,
        });
      }
      throw e;
    }
  }

  /**
   * Translates a storage-level version conflict into the API's 409.
   *
   * `currentVersion` rides along so a client can re-read and retry in one more
   * round trip rather than two — the shape ADMIN-API.md §2 fixed before
   * anything returned a 409, so C-9's clients adopt it rather than invent one.
   */
  private async persist<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof VersionConflictError) {
        throw new ConflictException({
          message: e.message,
          error: 'Conflict',
          statusCode: 409,
          currentVersion: e.currentVersion,
        });
      }
      throw e;
    }
  }
}
