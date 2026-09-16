import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Sql } from 'postgres';
import { DATABASE } from '@platform/shared/database';
import {
  ChannelReadModel,
  resolveChannelConfig,
  type Channel,
  type ChannelConfig,
  type TenantDefaults,
} from '@platform/modules/channels/contracts';
import { CHANNEL_QUERY } from './channel-read-model.provider';

/**
 * Periodic full reload of the read-model (C-15).
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * C-14's read-model is fed by events and falls through to the source on a
 * miss. That covers a *cold* replica. It does not cover a **stale hit**: the
 * in-process bus has no durability, retry or replay, so a dropped
 * `channels.archived` leaves a consumer confidently resolving a closed market,
 * with nothing detecting it — the request succeeds, the answer is wrong, and
 * no existing test notices. Read-through cannot help, because a hit never asks.
 *
 * At single-digit channels per tenant a full reload on an interval is
 * proportionate. The interval **is** the staleness bound: after a dropped
 * event, the replica is wrong for at most `reconcileMs`.
 *
 * ── Why it binds `app.system_worker`, and why that is asserted ───────────
 *
 * This runs on a timer with no request, so no `app.tenant_id` is bound. Under
 * RLS that means **zero rows** — a reload that reads nothing, replaces the
 * replica with nothing, and reports success. This project has shipped that
 * exact shape once already (a backfill that reported `0 = 0`), which is why
 * the channels tables carry the same `app.system_worker` clause as
 * `audit.webhook_outbox`: deliberately narrower than BYPASSRLS, set
 * transaction-locally so it cannot leak onto a pooled connection.
 *
 * And why a zero-row reload is **refused** rather than applied: the reconciler
 * cannot tell an RLS-blinded read from a genuinely empty database, and the
 * safe response to both is the same — leave the replica alone and say so.
 * Wiping a warm replica on a blinded read would turn every subsequent request
 * into a read-through storm against a database that then answers correctly,
 * masking the fault. Refusing keeps the fault visible.
 *
 * ── Atomic swap, not clear-then-fill ─────────────────────────────────────
 *
 * `replaceAll` builds the new maps and swaps them in one step. A clear followed
 * by a repopulate opens a window in which every request misses and falls
 * through — harmless for correctness, but it would make the reconciler itself
 * the cause of a periodic latency spike on every scoped request.
 */
@Injectable()
export class ChannelReconciler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelReconciler.name);
  private readonly reconcileMs = Number.parseInt(
    process.env['CHANNELS_RECONCILE_MS'] ?? '60000',
    10,
  );
  private timer?: NodeJS.Timeout;
  /** Guards against a slow reload overlapping the next tick. */
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly sql: Sql,
    @Inject(CHANNEL_QUERY) private readonly readModel: ChannelReadModel,
  ) {}

  onModuleInit(): void {
    if (process.env['CHANNELS_RECONCILE_MS'] === '0') return;
    this.timer = setInterval(() => void this.tick(), this.reconcileMs);
    // Don't hold the process open on shutdown for the sake of a reload.
    this.timer.unref();
    this.logger.log(`channel reconciler reloading every ${this.reconcileMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.reconcile();
    } catch (err) {
      // A failed reload leaves the replica as it was. Logged rather than
      // rethrown: an unhandled rejection inside a timer is a process crash for
      // a job whose entire job is to be quietly redundant.
      this.logger.error(`channel reconciliation failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Reload every active channel across every tenant into the replica.
   *
   * Returns what it read so a caller — the integration check, or a future
   * observability point (C-25) — can assert on it. `applied` is false when the
   * read came back empty and the replica was deliberately left untouched.
   */
  async reconcile(): Promise<{ tenants: number; channels: number; applied: boolean }> {
    const rows = await this.sql.begin(async (tx) => {
      // Transaction-local, exactly as the outbox does it: `true` scopes the
      // setting to this transaction so it cannot outlive it on the pool.
      await tx`SELECT set_config('app.system_worker', 'on', true)`;
      return tx<ReconcileRow[]>`
        SELECT c.id, c.tenant_id, c.key, c.name, c.status, c.is_default,
               c.has_transacted, c.version,
               c.currency_code, c.default_locale, c.supported_locales,
               c.country, c.timezone, c.tax_display, c.tax_rate_bps,
               c.external_ref, c.created_at, c.updated_at,
               d.currency_code      AS d_currency_code,
               d.default_locale     AS d_default_locale,
               d.supported_locales  AS d_supported_locales,
               d.country            AS d_country,
               d.timezone           AS d_timezone,
               d.tax_display        AS d_tax_display,
               d.tax_rate_bps       AS d_tax_rate_bps,
               d.version            AS d_version,
               d.created_at         AS d_created_at,
               d.updated_at         AS d_updated_at
          FROM channels.channels c
          JOIN channels.tenant_defaults d ON d.tenant_id = c.tenant_id
         WHERE c.status = 'active'
      `;
    });

    const tenants = new Set(rows.map((r) => r.tenant_id)).size;

    if (rows.length === 0) {
      // See the class doc: an RLS-blinded read and an empty database look
      // identical from here, and the safe answer to both is to change nothing.
      this.logger.warn(
        'channel reconciliation read ZERO active channels — the replica was left ' +
          'untouched. Either the database is empty, or this connection is not ' +
          'bound as app.system_worker and RLS is hiding every row.',
      );
      return { tenants: 0, channels: 0, applied: false };
    }

    const configs: ChannelConfig[] = rows.map((r) =>
      resolveChannelConfig(toChannel(r), toDefaults(r)).config,
    );
    this.readModel.replaceAll(configs);
    return { tenants, channels: configs.length, applied: true };
  }
}

interface ReconcileRow {
  id: string;
  tenant_id: string;
  key: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  is_default: boolean;
  has_transacted: boolean;
  version: number;
  currency_code: string | null;
  default_locale: string | null;
  supported_locales: string[] | null;
  country: string | null;
  timezone: string | null;
  tax_display: 'gross' | 'net' | null;
  tax_rate_bps: number | null;
  external_ref: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  d_currency_code: string;
  d_default_locale: string;
  d_supported_locales: string[];
  d_country: string;
  d_timezone: string;
  d_tax_display: 'gross' | 'net';
  d_tax_rate_bps: number | null;
  d_version: number;
  d_created_at: Date | string;
  d_updated_at: Date | string;
}

/**
 * A raw postgres-js connection does not necessarily hand back `timestamptz` as
 * a `Date` — that depends on the pool's parser configuration, and the tenant-
 * bound Drizzle path this module otherwise uses hides the difference. The first
 * real run of the reconciler threw `toISOString is not a function` on exactly
 * this. Coercing through `new Date()` is correct for either representation.
 */
const iso = (v: Date | string): string => new Date(v).toISOString();

const toChannel = (r: ReconcileRow): Channel => ({
  id: r.id,
  tenantId: r.tenant_id,
  key: r.key,
  name: r.name,
  status: r.status,
  isDefault: r.is_default,
  hasTransacted: r.has_transacted,
  version: r.version,
  currencyCode: r.currency_code,
  defaultLocale: r.default_locale,
  supportedLocales: r.supported_locales,
  country: r.country,
  timezone: r.timezone,
  taxDisplay: r.tax_display,
  taxRateBps: r.tax_rate_bps,
  externalRef: r.external_ref,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const toDefaults = (r: ReconcileRow): TenantDefaults => ({
  tenantId: r.tenant_id,
  currencyCode: r.d_currency_code,
  defaultLocale: r.d_default_locale,
  supportedLocales: r.d_supported_locales,
  country: r.d_country,
  timezone: r.d_timezone,
  taxDisplay: r.d_tax_display,
  taxRateBps: r.d_tax_rate_bps,
  version: r.d_version,
  createdAt: iso(r.d_created_at),
  updatedAt: iso(r.d_updated_at),
});
