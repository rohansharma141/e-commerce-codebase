import type { ChannelConfig } from './channel.dto';
import type {
  ChannelArchivedPayload,
  ChannelCreatedPayload,
  ChannelDefaultChangedPayload,
  ChannelUpdatedPayload,
  TenantDefaultsUpdatedPayload,
} from './events';
import type { IChannelsQuery } from './services';

/**
 * A consuming module's local replica of channel configuration (C-14).
 *
 * ── Why a replica at all ─────────────────────────────────────────────────
 *
 * Modules must not query `channels` on every write. It is a boundary violation
 * (a synchronous cross-module read on a write path) and a latency multiplier:
 * once channels is extracted, that read becomes a network hop inside every
 * cart mutation and every checkout. ADR-0014 §3 replicates by event instead.
 *
 * ── Why read-through, rather than events alone ───────────────────────────
 *
 * Events alone would make correctness depend on having received every message
 * ever published — including the ones sent before this process started, and
 * the ones dropped while it was restarting. A cold replica would reject writes
 * for channels that plainly exist.
 *
 * So a miss is not an error: it falls back to the source. That makes the
 * events an *optimisation* rather than a correctness requirement, which is the
 * property the C-14 check is written to demonstrate — stop publishing
 * `channels.created` entirely and writes against a new channel must still
 * succeed. If they fail, the module is querying rather than replicating, and
 * the event stream has quietly become load-bearing.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * Not a cache with an eviction policy, and deliberately unbounded: a tenant has
 * single-digit channels and the whole platform's set fits in memory many times
 * over. If channels ever proliferate this needs a bound, and CAVEATS records
 * that.
 *
 * Staleness is closed by C-15's periodic reconciliation, not here. This class
 * knows only how to be told, how to ask, and how to forget.
 *
 * Framework-free and in `contracts/` on purpose, so every consuming module
 * shares one implementation. Three modules each writing their own is how a
 * tenant's currency comes to depend on which module you ask.
 */
export class ChannelReadModel implements IChannelsQuery {
  /** `tenantId + NUL + key` → config. */
  private readonly byKey = new Map<string, ChannelConfig>();
  /** `tenantId + NUL + channelId` → config. */
  private readonly byId = new Map<string, ChannelConfig>();
  /** `tenantId` → the default channel's key. */
  private readonly defaultKey = new Map<string, string>();

  /** Counters, so a consumer's tests can assert replication actually avoids reads. */
  private sourceReads = 0;
  private hits = 0;

  constructor(private readonly source: IChannelsQuery) {}

  get stats(): { readonly sourceReads: number; readonly hits: number; readonly size: number } {
    return { sourceReads: this.sourceReads, hits: this.hits, size: this.byKey.size };
  }

  private static k(a: string, b: string): string {
    // NUL separator, written as an escape rather than a literal so this file
    // stays text. Tenant ids match [a-zA-Z0-9._-] and channel keys [a-z0-9-],
    // so neither can contain it and no two distinct pairs collide. A `.` or `-`
    // would NOT be safe: tenant `a.b` + key `c` would collide with tenant `a` +
    // key `b.c`.
    return `${a}\u0000${b}`;
  }

  async findByKey(tenantId: string, key: string): Promise<ChannelConfig | null> {
    const cached = this.byKey.get(ChannelReadModel.k(tenantId, key));
    if (cached) {
      this.hits += 1;
      return cached;
    }
    this.sourceReads += 1;
    const fresh = await this.source.findByKey(tenantId, key);
    // A null is NOT cached. Unknown and archived both resolve to null, and
    // caching that would make a newly-created channel unresolvable until the
    // entry expired — turning a miss into a durable wrong answer.
    if (fresh) this.remember(fresh);
    return fresh;
  }

  async findById(tenantId: string, channelId: string): Promise<ChannelConfig | null> {
    const cached = this.byId.get(ChannelReadModel.k(tenantId, channelId));
    if (cached) {
      this.hits += 1;
      return cached;
    }
    this.sourceReads += 1;
    const fresh = await this.source.findById(tenantId, channelId);
    if (fresh) this.remember(fresh);
    return fresh;
  }

  async findDefault(tenantId: string): Promise<ChannelConfig> {
    const key = this.defaultKey.get(tenantId);
    if (key) {
      const cached = this.byKey.get(ChannelReadModel.k(tenantId, key));
      if (cached) {
        this.hits += 1;
        return cached;
      }
    }
    this.sourceReads += 1;
    const fresh = await this.source.findDefault(tenantId);
    this.remember(fresh);
    this.defaultKey.set(tenantId, fresh.key);
    return fresh;
  }

  /**
   * Never served from the replica.
   *
   * A partial replica cannot answer a *completeness* question: it knows the
   * channels it has been told about, not that they are all of them. Returning a
   * subset here would silently hide markets from anything listing them, which
   * is worse than the read it avoids.
   */
  async listActive(tenantId: string): Promise<readonly ChannelConfig[]> {
    this.sourceReads += 1;
    const all = await this.source.listActive(tenantId);
    for (const c of all) this.remember(c);
    return all;
  }

  private remember(config: ChannelConfig): void {
    this.byKey.set(ChannelReadModel.k(config.tenantId, config.key), config);
    this.byId.set(ChannelReadModel.k(config.tenantId, config.channelId), config);
    if (config.isDefault) this.defaultKey.set(config.tenantId, config.key);
  }

  private forget(tenantId: string, channelId: string, key: string): void {
    this.byKey.delete(ChannelReadModel.k(tenantId, key));
    this.byId.delete(ChannelReadModel.k(tenantId, channelId));
    if (this.defaultKey.get(tenantId) === key) this.defaultKey.delete(tenantId);
  }

  // ── event application ───────────────────────────────────────────────────
  //
  // Every one of these is an upsert or a delete keyed on identity, never an
  // append. The bus redelivers, so a handler that accumulates corrupts on the
  // second delivery — and the second delivery is invisible in testing unless
  // you deliberately send it twice.

  onCreated(p: ChannelCreatedPayload): void {
    this.remember(p.config);
  }

  onUpdated(p: ChannelUpdatedPayload): void {
    // A rename changes the key this config is filed under, so the old entry
    // must go or `findByKey` keeps answering for a key that no longer exists.
    const previous = this.byId.get(ChannelReadModel.k(p.config.tenantId, p.config.channelId));
    if (previous && previous.key !== p.config.key) {
      this.byKey.delete(ChannelReadModel.k(previous.tenantId, previous.key));
    }
    this.remember(p.config);
  }

  onArchived(p: ChannelArchivedPayload): void {
    // Dropped, not marked archived. `findByKey` must return null for it, and a
    // subsequent read-through asks the source, which also returns null.
    this.forget(p.tenantId, p.channelId, p.key);
  }

  onDefaultChanged(p: ChannelDefaultChangedPayload): void {
    this.defaultKey.set(p.tenantId, p.newDefaultKey);
    // The `isDefault` flag on both configs is now stale. Rather than mutate
    // cached copies, drop them: the next read re-fetches with the flag correct.
    if (p.previousDefaultChannelId) {
      const prev = this.byId.get(ChannelReadModel.k(p.tenantId, p.previousDefaultChannelId));
      if (prev) this.forget(p.tenantId, prev.channelId, prev.key);
    }
    const next = this.byId.get(ChannelReadModel.k(p.tenantId, p.newDefaultChannelId));
    if (next) this.forget(p.tenantId, next.channelId, next.key);
  }

  /**
   * Wholesale invalidation for the tenant.
   *
   * A defaults edit changes the resolved config of every channel that inherits
   * the edited field, and the event does not say which those are. Recomputing
   * here would mean reimplementing inheritance in a second place — the thing
   * `resolveChannelConfig` exists to prevent — so the replica forgets and
   * re-reads instead. Correct, and cheap at single-digit channels per tenant.
   */
  onTenantDefaultsUpdated(p: TenantDefaultsUpdatedPayload): void {
    this.invalidateTenant(p.defaults.tenantId);
  }

  invalidateTenant(tenantId: string): void {
    const prefix = `${tenantId}\u0000`;
    for (const k of [...this.byKey.keys()]) if (k.startsWith(prefix)) this.byKey.delete(k);
    for (const k of [...this.byId.keys()]) if (k.startsWith(prefix)) this.byId.delete(k);
    this.defaultKey.delete(tenantId);
  }

  /** Drops everything. C-15's reconciliation uses this before a full reload. */
  clear(): void {
    this.byKey.clear();
    this.byId.clear();
    this.defaultKey.clear();
  }
}
