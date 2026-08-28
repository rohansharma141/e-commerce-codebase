import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertChannelValid,
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
  ) {}

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
    return this.store.create(tenantId, dto);
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
    return this.persist(() => this.store.update(tenantId, channelId, dto, expectedVersion));
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
    return this.store.promoteDefault(tenantId, channelId);
  }

  async updateTenantDefaults(
    tenantId: string,
    dto: UpdateTenantDefaultsDto,
    expectedVersion: number,
  ): Promise<TenantDefaults> {
    await this.requireDefaults(tenantId);
    return this.persist(() =>
      this.store.updateTenantDefaults(tenantId, dto, expectedVersion),
    );
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
