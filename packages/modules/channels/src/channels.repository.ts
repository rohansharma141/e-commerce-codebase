import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import {
  TENANT_DRIZZLE,
  clampLimit,
  decodeCursor,
  toPage,
  type TenantDrizzleAccessor,
} from '@platform/shared/database';
import {
  resolveChannelConfig,
  type Channel,
  type ChannelConfig,
  type ChannelStatus,
  type CreateChannelDto,
  type ResolvedChannel,
  type TenantDefaults,
  type UpdateChannelDto,
  type UpdateTenantDefaultsDto,
} from '@platform/modules/channels/contracts';
import { channels, tenantDefaults, type ChannelRow, type TenantDefaultsRow } from './db/schema';

/**
 * Persistence for channels and tenant defaults.
 *
 * Resolution is NOT implemented here — it calls `resolveChannelConfig` from the
 * contracts, which is pure and separately tested. Inheritance is resolved in
 * three places (this repository, the consuming read-models in C-14, the back
 * office in C-24), and three implementations is how a tenant ends up with a
 * currency that depends on which endpoint you ask.
 *
 * Invariant enforcement is likewise not here: the rules are pure predicates in
 * `contracts/invariants.ts` and are wired in at C-8b. What this file owns is
 * the two things that genuinely belong to persistence — optimistic concurrency
 * via `version`, and the default-promotion transaction.
 */

export class VersionConflictError extends Error {
  readonly currentVersion: number;
  constructor(currentVersion: number) {
    super(`version conflict: the record has moved on to version ${currentVersion}`);
    this.name = 'VersionConflictError';
    this.currentVersion = currentVersion;
  }
}

const toChannel = (r: ChannelRow): Channel => ({
  id: r.id,
  tenantId: r.tenantId,
  key: r.key,
  name: r.name,
  status: r.status,
  isDefault: r.isDefault,
  hasTransacted: r.hasTransacted,
  version: r.version,
  currencyCode: r.currencyCode,
  defaultLocale: r.defaultLocale,
  supportedLocales: r.supportedLocales,
  country: r.country,
  timezone: r.timezone,
  taxDisplay: r.taxDisplay,
  taxRateBps: r.taxRateBps,
  externalRef: r.externalRef,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toDefaults = (r: TenantDefaultsRow): TenantDefaults => ({
  tenantId: r.tenantId,
  currencyCode: r.currencyCode,
  defaultLocale: r.defaultLocale,
  supportedLocales: r.supportedLocales,
  country: r.country,
  timezone: r.timezone,
  taxDisplay: r.taxDisplay,
  taxRateBps: r.taxRateBps,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/**
 * Applies `PATCH` merge semantics to one column.
 *
 * `undefined` means the caller omitted the field: leave it alone, which for a
 * SQL UPDATE means not naming the column at all. `null` means set to null,
 * i.e. resume inheriting. Collapsing the two would make "stop overriding this"
 * inexpressible — see ADMIN-API.md §3.
 */
function put<T>(
  values: Record<string, unknown>,
  column: string,
  value: T | null | undefined,
): void {
  if (value !== undefined) values[column] = value;
}

@Injectable()
export class ChannelsRepository {
  constructor(@Inject(TENANT_DRIZZLE) private readonly accessor: TenantDrizzleAccessor) {}
  private get db() {
    return this.accessor.get();
  }

  // ── tenant defaults ─────────────────────────────────────────────────────

  async findTenantDefaults(tenantId: string): Promise<TenantDefaults | null> {
    const [row] = await this.db
      .select()
      .from(tenantDefaults)
      .where(eq(tenantDefaults.tenantId, tenantId))
      .limit(1);
    return row ? toDefaults(row) : null;
  }

  async upsertTenantDefaults(
    tenantId: string,
    values: {
      currencyCode: string;
      defaultLocale: string;
      supportedLocales: readonly string[];
      country: string;
      timezone: string;
      taxDisplay: 'gross' | 'net';
      taxRateBps: number | null;
    },
  ): Promise<TenantDefaults> {
    const [row] = await this.db
      .insert(tenantDefaults)
      .values({ tenantId, ...values, supportedLocales: [...values.supportedLocales] })
      .onConflictDoUpdate({
        target: tenantDefaults.tenantId,
        set: {
          ...values,
          supportedLocales: [...values.supportedLocales],
          updatedAt: sql`now()`,
          version: sql`${tenantDefaults.version} + 1`,
        },
      })
      .returning();
    return toDefaults(row as TenantDefaultsRow);
  }

  async updateTenantDefaults(
    tenantId: string,
    dto: UpdateTenantDefaultsDto,
    expectedVersion: number,
  ): Promise<TenantDefaults> {
    const set: Record<string, unknown> = {
      updatedAt: sql`now()`,
      version: sql`${tenantDefaults.version} + 1`,
    };
    put(set, 'currency_code', dto.currencyCode);
    put(set, 'default_locale', dto.defaultLocale);
    put(set, 'supported_locales', dto.supportedLocales ? [...dto.supportedLocales] : undefined);
    put(set, 'country', dto.country);
    put(set, 'timezone', dto.timezone);
    put(set, 'tax_display', dto.taxDisplay);
    put(set, 'tax_rate_bps', dto.taxRateBps);

    const [row] = await this.db
      .update(tenantDefaults)
      .set(set)
      .where(
        and(
          eq(tenantDefaults.tenantId, tenantId),
          eq(tenantDefaults.version, expectedVersion),
        ),
      )
      .returning();

    if (!row) await this.throwConflictOrMissing(tenantId);
    return toDefaults(row as TenantDefaultsRow);
  }

  /**
   * Distinguishes "someone else wrote first" from "no such row".
   *
   * A `WHERE version = ?` that matches nothing is ambiguous, and reporting a
   * conflict for a missing record sends a client into a re-read-and-retry loop
   * against something that will never exist.
   */
  private async throwConflictOrMissing(tenantId: string): Promise<never> {
    const current = await this.findTenantDefaults(tenantId);
    if (!current) throw new Error(`no tenant defaults for ${tenantId}`);
    throw new VersionConflictError(current.version);
  }

  // ── channels: reads ─────────────────────────────────────────────────────

  private async rowByKey(tenantId: string, key: string): Promise<ChannelRow | undefined> {
    const [row] = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), eq(channels.key, key)))
      .limit(1);
    return row;
  }

  /**
   * Resolve by key. Returns null for unknown, **archived**, and cross-tenant
   * keys alike — the caller turns that into a 404 and must never fall back to
   * the default. Silent fallback means a typo serves a different market's
   * prices and looks like it worked. Archived is grouped with unknown
   * deliberately: a closed market should stop resolving, not degrade to a
   * working one.
   *
   * Cross-tenant needs no branch here: RLS never returns the row.
   */
  async findByKey(tenantId: string, key: string): Promise<ChannelConfig | null> {
    const row = await this.rowByKey(tenantId, key);
    if (!row || row.status === 'archived') return null;
    return (await this.resolve(row)).config;
  }

  async findById(tenantId: string, channelId: string): Promise<ChannelConfig | null> {
    const [row] = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), eq(channels.id, channelId)))
      .limit(1);
    if (!row || row.status === 'archived') return null;
    return (await this.resolve(row)).config;
  }

  /** The tenant's default channel. Throws if none — a tenant without one resolves nothing. */
  async findDefault(tenantId: string): Promise<ChannelConfig> {
    const [row] = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), eq(channels.isDefault, true)))
      .limit(1);
    if (!row) {
      throw new Error(
        `tenant ${tenantId} has no default channel. Every tenant must have exactly ` +
          `one; the partial unique index guarantees at most one, and the backfill ` +
          `(C-11) guarantees at least one.`,
      );
    }
    return (await this.resolve(row)).config;
  }

  async listActive(tenantId: string): Promise<readonly ChannelConfig[]> {
    const rows = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), eq(channels.status, 'active')))
      .orderBy(asc(channels.key));
    const defaults = await this.requireDefaults(tenantId);
    return rows.map((r) => resolveChannelConfig(toChannel(r), defaults).config);
  }

  /** The management view: drafts and archived included, with provenance. */
  async list(tenantId: string): Promise<readonly ResolvedChannel[]> {
    const rows = await this.db
      .select()
      .from(channels)
      .where(eq(channels.tenantId, tenantId))
      .orderBy(asc(channels.key));
    const defaults = await this.requireDefaults(tenantId);
    return rows.map((r) => resolveChannelConfig(toChannel(r), defaults));
  }

  /**
   * The admin list, paged on `key`.
   *
   * `key` rather than `id` because `channels_tenant_key_unique` makes it a
   * total order within a tenant, and an operator scanning markets wants them
   * alphabetical rather than in UUID order — the same reasoning as
   * attribute-definitions in C-1.
   */
  async listPage(
    tenantId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: readonly ResolvedChannel[]; nextCursor: string | null }> {
    const cap = clampLimit(opts.limit);
    const keyset = opts.cursor ? decodeCursor(opts.cursor, 1) : undefined;
    const where = keyset
      ? and(eq(channels.tenantId, tenantId), gt(channels.key, keyset[0] as string))
      : eq(channels.tenantId, tenantId);

    const rows = await this.db
      .select()
      .from(channels)
      .where(where)
      .orderBy(asc(channels.key))
      .limit(cap + 1);

    const page = toPage(rows, cap, (row) => [row.key]);
    if (page.items.length === 0) return { items: [], nextCursor: page.nextCursor };

    // Defaults are fetched once for the page, not once per row.
    const defaults = await this.requireDefaults(tenantId);
    return {
      items: page.items.map((r) => resolveChannelConfig(toChannel(r), defaults)),
      nextCursor: page.nextCursor,
    };
  }

  async get(tenantId: string, channelId: string): Promise<ResolvedChannel | null> {
    const [row] = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), eq(channels.id, channelId)))
      .limit(1);
    return row ? this.resolve(row) : null;
  }

  /** The stored row, unresolved — what invariant checks operate on. */
  async getRaw(tenantId: string, channelId: string): Promise<Channel | null> {
    const [row] = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), eq(channels.id, channelId)))
      .limit(1);
    return row ? toChannel(row) : null;
  }

  async countActive(tenantId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(channels)
      .where(and(eq(channels.tenantId, tenantId), eq(channels.status, 'active')));
    return row?.n ?? 0;
  }

  private async requireDefaults(tenantId: string): Promise<TenantDefaults> {
    const defaults = await this.findTenantDefaults(tenantId);
    if (!defaults) {
      throw new Error(
        `tenant ${tenantId} has no channels.tenant_defaults row, so channel ` +
          `configuration cannot be resolved. The backfill (C-11) creates one for ` +
          `every tenant that has pricing config.`,
      );
    }
    return defaults;
  }

  private async resolve(row: ChannelRow): Promise<ResolvedChannel> {
    return resolveChannelConfig(toChannel(row), await this.requireDefaults(row.tenantId));
  }

  // ── channels: writes ────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateChannelDto): Promise<Channel> {
    const [row] = await this.db
      .insert(channels)
      .values({
        tenantId,
        key: dto.key,
        name: dto.name,
        status: (dto.status ?? 'draft') as ChannelStatus,
        currencyCode: dto.currencyCode ?? null,
        defaultLocale: dto.defaultLocale ?? null,
        supportedLocales: dto.supportedLocales ? [...dto.supportedLocales] : null,
        country: dto.country ?? null,
        timezone: dto.timezone ?? null,
        taxDisplay: dto.taxDisplay ?? null,
        taxRateBps: dto.taxRateBps ?? null,
        externalRef: dto.externalRef ?? null,
      })
      .returning();
    return toChannel(row as ChannelRow);
  }

  async update(
    tenantId: string,
    channelId: string,
    dto: UpdateChannelDto & { readonly key?: string },
    expectedVersion: number,
  ): Promise<Channel> {
    const set: Record<string, unknown> = {
      updatedAt: sql`now()`,
      version: sql`${channels.version} + 1`,
    };
    put(set, 'key', dto.key);
    put(set, 'name', dto.name);
    put(set, 'status', dto.status);
    put(set, 'currency_code', dto.currencyCode);
    put(set, 'default_locale', dto.defaultLocale);
    put(set, 'supported_locales', dto.supportedLocales ? [...dto.supportedLocales] : dto.supportedLocales);
    put(set, 'country', dto.country);
    put(set, 'timezone', dto.timezone);
    put(set, 'tax_display', dto.taxDisplay);
    put(set, 'tax_rate_bps', dto.taxRateBps);
    put(set, 'external_ref', dto.externalRef);

    const [row] = await this.db
      .update(channels)
      .set(set)
      .where(
        and(
          eq(channels.tenantId, tenantId),
          eq(channels.id, channelId),
          eq(channels.version, expectedVersion),
        ),
      )
      .returning();

    if (!row) {
      const current = await this.getRaw(tenantId, channelId);
      if (!current) throw new Error(`no channel ${channelId} for tenant ${tenantId}`);
      throw new VersionConflictError(current.version);
    }
    return toChannel(row as ChannelRow);
  }

  /**
   * Promote a channel to default.
   *
   * Two writes racing the `channels_one_default_per_tenant` partial unique
   * index. They run in ONE transaction with the unset strictly before the set:
   * doing it the other way round means two defaults exist momentarily and the
   * index rejects the second write, which surfaces as an intermittent
   * constraint violation in production and nowhere else.
   *
   * Two concurrent promotions still contend. The second blocks on the first's
   * row lock and then proceeds against committed state, so one wins cleanly
   * rather than both failing — that is the behaviour C-8b's concurrency test
   * has to demonstrate, and it is the reason this is a transaction rather than
   * two statements.
   */
  async promoteDefault(tenantId: string, channelId: string): Promise<Channel> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(channels)
        .set({ isDefault: false, updatedAt: sql`now()` })
        .where(and(eq(channels.tenantId, tenantId), eq(channels.isDefault, true)));

      const [row] = await tx
        .update(channels)
        .set({
          isDefault: true,
          updatedAt: sql`now()`,
          version: sql`${channels.version} + 1`,
        })
        .where(and(eq(channels.tenantId, tenantId), eq(channels.id, channelId)))
        .returning();

      if (!row) throw new Error(`no channel ${channelId} for tenant ${tenantId}`);
      return toChannel(row as ChannelRow);
    });
  }

  /** Set by the `orders.created` consumer (C-17). Freezes the channel's currency. */
  async markTransacted(tenantId: string, channelId: string): Promise<void> {
    await this.db
      .update(channels)
      .set({ hasTransacted: true, updatedAt: sql`now()` })
      .where(and(eq(channels.tenantId, tenantId), eq(channels.id, channelId)));
  }
}
