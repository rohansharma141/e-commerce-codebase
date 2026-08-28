/**
 * A **sales channel**: a selling context within a tenant — a UK store in GBP,
 * a German one in EUR — each with its own currency, locales, country, timezone
 * and tax treatment.
 *
 * It is not a supply location. "Where you sell" and "where stock lives" share
 * an id and a name and nothing else; inventory will bring its own
 * `InventorySource` rather than overloading this. ADR-0014 records why a single
 * entity with a `roles` array was rejected: the field sets barely overlap, so
 * roles force either meaningless-nullable columns or a JSON blob, and the
 * retrofit is asymmetric — adding `InventorySource` later costs nothing,
 * unpicking a shared table that catalog, pricing and orders all query does not.
 */

export const CHANNEL_STATUSES = ['draft', 'active', 'archived'] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const TAX_DISPLAYS = ['gross', 'net'] as const;
/**
 * How prices are presented: `gross` is tax-inclusive (European retail), `net`
 * is tax-added-at-checkout (US).
 *
 * The pricing engine computes `net` only today, and `Query.capabilities` still
 * reports a constant. Making this field editable before the engine honours it
 * would let an operator select `gross` and be served `net` — a control wired to
 * nothing, which is worse than no control. The engine work is Phase G
 * (C-29..C-31), sequenced engine → field → storefront.
 */
export type TaxDisplay = (typeof TAX_DISPLAYS)[number];

/**
 * Per-tenant baseline. Every channel inherits from this unless it overrides.
 *
 * One edit here changes every channel that has not deliberately opted out —
 * which is the point. Fifteen European markets should not be fifteen
 * hand-maintained copies where one missed edit is a compliance incident.
 */
export interface TenantDefaults {
  readonly tenantId: string;
  /** ISO 4217. */
  readonly currencyCode: string;
  /** BCP 47. */
  readonly defaultLocale: string;
  /** BCP 47. Drives formatting, never translation — see ADR-0014 §10. */
  readonly supportedLocales: readonly string[];
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
  /** IANA, e.g. `Europe/London`. */
  readonly timezone: string;
  readonly taxDisplay: TaxDisplay;
  /**
   * Basis points. Interim: one flat rate, no tax classes, no destination-based
   * US tax, no EU OSS, no B2B reverse charge. Null once a real tax provider
   * lands. Defensible only as a *stated* simplification, which is why it is
   * stated here and in CAVEATS rather than only in a commit message.
   */
  readonly taxRateBps: number | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A channel as stored.
 *
 * **Every config field is nullable, and null means "inherit"** — not "unset",
 * and not "empty". That distinction is load-bearing: it keeps "inherited" and
 * "happens to currently match the default" distinguishable, so the back office
 * can show which is which and `PATCH` can express "stop overriding this" by
 * sending an explicit null.
 *
 * `ChannelConfig` is the resolved counterpart, with no nulls left.
 */
export interface Channel {
  /**
   * Immutable surrogate. **This is what other modules store**, because it
   * survives every rename.
   */
  readonly id: string;
  readonly tenantId: string;
  /**
   * The human and integration handle, unique per tenant, and **immutable once
   * the channel leaves `draft`**.
   *
   * A key appears in URLs, integration config and cache paths, which makes it a
   * foreign reference whether or not the database treats it as one. Renaming
   * orphans callers — or worse, silently resolves to a different market if the
   * old key is later reused. `name` carries all display mutability.
   */
  readonly key: string;
  /** Display only, freely mutable. */
  readonly name: string;
  readonly status: ChannelStatus;
  /** Exactly one per tenant, enforced by a partial unique index. */
  readonly isDefault: boolean;
  /**
   * Set once by `orders.created`. Freezes `currencyCode`: changing it after
   * money has moved would silently reinterpret every existing order's
   * minor-unit integers. Order snapshots protect *rendering*, not aggregation.
   */
  readonly hasTransacted: boolean;
  /** Increments on every write. Mutations carry the expected value; mismatch is 409. */
  readonly version: number;

  // ── null means inherit from TenantDefaults ──────────────────────────────
  readonly currencyCode: string | null;
  readonly defaultLocale: string | null;
  readonly supportedLocales: readonly string[] | null;
  readonly country: string | null;
  readonly timezone: string | null;
  readonly taxDisplay: TaxDisplay | null;
  readonly taxRateBps: number | null;

  /** Opaque mapping to an ERP/OMS/PIM. The platform never interprets it. */
  readonly externalRef: string | null;

  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A channel's **resolved** configuration: the channel coalesced over its
 * tenant's defaults, with nothing left to inherit.
 *
 * This is what consumers cache and what `capabilities` reports. The back office
 * edits `Channel` (so it can show what is inherited); everything else reads
 * `ChannelConfig` (so it never has to know that inheritance exists).
 */
export interface ChannelConfig {
  readonly channelId: string;
  readonly tenantId: string;
  readonly key: string;
  readonly name: string;
  readonly status: ChannelStatus;
  readonly isDefault: boolean;

  readonly currencyCode: string;
  /**
   * Decimal places for `currencyCode`, **derived** rather than stored.
   *
   * A per-channel editable copy permits GBP-with-exponent-0, which makes every
   * price on that channel wrong by a factor of a hundred. The exponent is a
   * property of the currency under ISO 4217, not of the channel.
   *
   * Order snapshots are the deliberate exception — they *store* it, because an
   * order must render as charged even if a standard later changes. Different
   * rules for different lifetimes.
   */
  readonly currencyMinorUnits: number;
  readonly defaultLocale: string;
  readonly supportedLocales: readonly string[];
  readonly country: string;
  readonly timezone: string;
  readonly taxDisplay: TaxDisplay;
  readonly taxRateBps: number | null;
}

/**
 * Which fields a resolved config actually inherited.
 *
 * The back office needs "this is inherited" to be different from "this happens
 * to equal the default", so it can render an override affordance rather than a
 * value that mysteriously changes when someone edits tenant defaults.
 */
export type InheritedFields = ReadonlySet<keyof ChannelConfig>;

export interface ResolvedChannel {
  readonly config: ChannelConfig;
  readonly inherited: InheritedFields;
}

// ── Write DTOs ────────────────────────────────────────────────────────────

export interface CreateChannelDto {
  readonly key: string;
  readonly name: string;
  /** Defaults to `draft`, so a market can be prepared before it is exposed. */
  readonly status?: ChannelStatus;
  readonly currencyCode?: string | null;
  readonly defaultLocale?: string | null;
  readonly supportedLocales?: readonly string[] | null;
  readonly country?: string | null;
  readonly timezone?: string | null;
  readonly taxDisplay?: TaxDisplay | null;
  readonly taxRateBps?: number | null;
  readonly externalRef?: string | null;
}

/**
 * `PATCH` semantics, and the reason they are spelled out rather than assumed:
 *
 *   - **field omitted**        → leave it alone
 *   - **field explicitly null** → set to null, i.e. resume inheriting
 *
 * Collapsing those two would make "stop overriding this" inexpressible. In
 * TypeScript the distinction survives because `undefined` and `null` are
 * different; over the wire it survives because JSON distinguishes an absent key
 * from a null one. Any transport that normalises one to the other breaks this.
 */
export interface UpdateChannelDto {
  readonly name?: string;
  readonly status?: ChannelStatus;
  readonly currencyCode?: string | null;
  readonly defaultLocale?: string | null;
  readonly supportedLocales?: readonly string[] | null;
  readonly country?: string | null;
  readonly timezone?: string | null;
  readonly taxDisplay?: TaxDisplay | null;
  readonly taxRateBps?: number | null;
  readonly externalRef?: string | null;
}

export interface UpdateTenantDefaultsDto {
  readonly currencyCode?: string;
  readonly defaultLocale?: string;
  readonly supportedLocales?: readonly string[];
  readonly country?: string;
  readonly timezone?: string;
  readonly taxDisplay?: TaxDisplay;
  readonly taxRateBps?: number | null;
}
