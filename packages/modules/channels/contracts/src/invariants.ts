import type {
  Channel,
  ChannelStatus,
  CreateChannelDto,
  UpdateChannelDto,
} from './channel.dto';
import { CHANNEL_STATUSES } from './channel.dto';

/**
 * The channel invariants, as pure predicates.
 *
 * Separated from persistence so each rule can be tested by attempting the
 * violation, rather than inferred from a repository that happens not to allow
 * it. The repository (C-7) enforces them by calling these; the database
 * enforces the two that must not fail open — `unique (tenant_id, key)` and
 * `unique (tenant_id) where is_default` — because an application-only
 * guarantee of "exactly one default" is not a guarantee.
 *
 * Violations are **returned, not thrown**, and all of them at once. The back
 * office edits a whole channel in one form, so surfacing the first problem and
 * hiding the rest turns one round trip into four. `assertChannelValid` throws
 * for callers that just want a guard.
 */

export type ChannelViolationCode =
  | 'key.invalid-format'
  | 'key.immutable'
  | 'currency.unsupported'
  | 'currency.frozen'
  | 'status.invalid-transition'
  | 'status.no-return-to-draft'
  | 'default.must-be-active'
  | 'default.cannot-archive'
  | 'tenant.needs-one-active-channel';

export interface ChannelViolation {
  readonly code: ChannelViolationCode;
  readonly field: string;
  readonly message: string;
}

export class ChannelInvariantError extends Error {
  readonly violations: readonly ChannelViolation[];
  constructor(violations: readonly ChannelViolation[]) {
    super(violations.map((v) => v.message).join('; '));
    this.name = 'ChannelInvariantError';
    this.violations = violations;
  }
}

/**
 * Channel keys travel in URL paths (`/api/{tenant}/{key}/graphql`), integration
 * config and cache tags, so the character set is deliberately narrow: nothing
 * that needs percent-encoding, no uppercase (URLs are compared
 * case-sensitively but humans do not type them that way), no leading or
 * trailing hyphen.
 *
 * 64 is the same ceiling tenant ids use, so neither half of a scoped path can
 * surprise the other.
 */
const CHANNEL_KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isValidChannelKey(key: string): boolean {
  return CHANNEL_KEY_RE.test(key);
}

/**
 * Currencies this deployment will accept on a channel.
 *
 * The allowlist exists because `minorUnitsFor` cannot tell a typo from a real
 * currency — `Intl` reports the CLDR default of 2 for any well-formed code it
 * does not recognise. Write time is where a mistyped currency has to be caught,
 * because after the first order `currencyCode` freezes and the mistake becomes
 * permanent.
 *
 * Passed as a parameter with this as the default, so widening it is a
 * deployment decision rather than a code change to a contract.
 */
export const SUPPORTED_CURRENCIES: readonly string[] = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'JPY',
];

/**
 * Which status changes are permitted.
 *
 * The one rule that is not merely lifecycle hygiene is **nothing returns to
 * `draft`**. `key` is immutable once a channel leaves `draft`; if a channel
 * could be moved back, that immutability would be trivially circumventable —
 * archive, return to draft, rename, re-activate — and every URL, integration
 * and cache tag pointing at the old key would silently resolve elsewhere. The
 * rule protects an invariant stated elsewhere, so it cannot be relaxed on its
 * own.
 *
 * `archived → active` is permitted: a market can reopen, and forbidding it
 * would make a mis-archive unrecoverable. It is safe precisely because the key
 * is already frozen by then.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ChannelStatus, readonly ChannelStatus[]>> = {
  draft: ['draft', 'active', 'archived'],
  active: ['active', 'archived'],
  archived: ['archived', 'active'],
};

export function canTransition(from: ChannelStatus, to: ChannelStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Facts the pure rules cannot see for themselves. */
export interface ChannelUpdateContext {
  /**
   * How many channels of this tenant are `active`, counting the one being
   * updated. A tenant with zero active channels resolves no requests at all,
   * and the failure surfaces at the next request rather than at the operation
   * that caused it.
   */
  readonly activeChannelCount: number;
  /** Defaults to `SUPPORTED_CURRENCIES`. */
  readonly supportedCurrencies?: readonly string[];
}

/**
 * Validate a patch against the channel's current state.
 *
 * Returns every violation, or an empty array. A field absent from `patch` is
 * left alone and is never validated — that is the `PATCH` merge semantics of
 * ADMIN-API.md §3, and validating omitted fields would make it impossible to
 * edit a channel that is already in a state a newer rule forbids.
 */
export function validateChannelUpdate(
  current: Channel,
  patch: UpdateChannelDto & { readonly key?: string },
  ctx: ChannelUpdateContext,
): readonly ChannelViolation[] {
  const violations: ChannelViolation[] = [];
  const allowed = ctx.supportedCurrencies ?? SUPPORTED_CURRENCIES;

  // ── key ────────────────────────────────────────────────────────────────
  if (patch.key !== undefined && patch.key !== current.key) {
    if (current.status !== 'draft') {
      violations.push({
        code: 'key.immutable',
        field: 'key',
        message:
          `key cannot change once a channel leaves draft (this one is ${current.status}). ` +
          'It appears in URLs, integration config and cache paths, so renaming it ' +
          'orphans callers — or silently resolves to a different market if the old ' +
          'key is later reused. Change `name` instead; it is display-only.',
      });
    }
    if (!isValidChannelKey(patch.key)) {
      violations.push({
        code: 'key.invalid-format',
        field: 'key',
        message: `key must match ${CHANNEL_KEY_RE.source}`,
      });
    }
  }

  // ── currency ───────────────────────────────────────────────────────────
  if (patch.currencyCode !== undefined && patch.currencyCode !== null) {
    if (patch.currencyCode !== current.currencyCode && current.hasTransacted) {
      violations.push({
        code: 'currency.frozen',
        field: 'currencyCode',
        message:
          'currencyCode cannot change once the channel has transacted. Every ' +
          'existing order stores money as an integer in this currency’s minor ' +
          'units; changing it reinterprets all of them silently. Order snapshots ' +
          'protect how an order renders, not what it aggregates to.',
      });
    }
    if (!allowed.includes(patch.currencyCode.toUpperCase())) {
      violations.push({
        code: 'currency.unsupported',
        field: 'currencyCode',
        message:
          `currencyCode "${patch.currencyCode}" is not supported by this deployment ` +
          `(${allowed.join(', ')}). A well-formed but unassigned code would otherwise ` +
          'be accepted and silently treated as having 2 decimal places.',
      });
    }
  }
  // Clearing the override back to inherit is always allowed: the tenant
  // default is itself validated, and this changes no stored currency of its own.

  // ── status ─────────────────────────────────────────────────────────────
  if (patch.status !== undefined && patch.status !== current.status) {
    if (patch.status === 'draft') {
      violations.push({
        code: 'status.no-return-to-draft',
        field: 'status',
        message:
          'a channel cannot return to draft. Doing so would unfreeze `key`, making ' +
          'its immutability circumventable by archiving and re-drafting.',
      });
    } else if (!canTransition(current.status, patch.status)) {
      violations.push({
        code: 'status.invalid-transition',
        field: 'status',
        message: `cannot move a channel from ${current.status} to ${patch.status}`,
      });
    }

    if (patch.status === 'archived') {
      if (current.isDefault) {
        violations.push({
          code: 'default.cannot-archive',
          field: 'status',
          message:
            'the default channel cannot be archived. Promote another channel to ' +
            'default first — unspecified requests fall back to the default, so a ' +
            'tenant without one resolves nothing.',
        });
      }
      if (current.status === 'active' && ctx.activeChannelCount <= 1) {
        violations.push({
          code: 'tenant.needs-one-active-channel',
          field: 'status',
          message:
            'archiving this channel would leave the tenant with no active channel, ' +
            'and the failure would surface at the next request rather than here.',
        });
      }
    }
  }

  return violations;
}

/**
 * Validate a create.
 *
 * Expressed as an update against a synthetic empty draft rather than as a
 * second rule set. A create is exactly "an update to a channel that does not
 * exist yet": the key is mutable because the status is `draft`, the currency is
 * free because nothing has transacted, and the format and allowlist checks are
 * the same ones. Writing them twice is how the two drift and a rule ends up
 * enforced on edit but not on create — which is the worse direction, because
 * the bad value is already stored by the time anyone notices.
 */
export function validateChannelCreate(
  tenantId: string,
  dto: CreateChannelDto,
  ctx: ChannelUpdateContext,
): readonly ChannelViolation[] {
  const blank: Channel = {
    id: '',
    tenantId,
    key: '',
    name: '',
    status: 'draft',
    isDefault: false,
    hasTransacted: false,
    version: 0,
    currencyCode: null,
    defaultLocale: null,
    supportedLocales: null,
    country: null,
    timezone: null,
    taxDisplay: null,
    taxRateBps: null,
    externalRef: null,
    createdAt: '',
    updatedAt: '',
  };
  return validateChannelUpdate(blank, { ...dto, key: dto.key }, ctx);
}

/**
 * The default channel must be active.
 *
 * Separate from `validateChannelUpdate` because promotion is its own operation
 * (two writes racing a partial unique index, so it must be one transaction),
 * not a field on a patch.
 */
export function validatePromoteDefault(candidate: Channel): readonly ChannelViolation[] {
  if (candidate.status !== 'active') {
    return [
      {
        code: 'default.must-be-active',
        field: 'isDefault',
        message:
          `cannot make a ${candidate.status} channel the default. The default is ` +
          'what unspecified requests resolve to, so a draft or archived default ' +
          'would fail every unscoped request for the tenant.',
      },
    ];
  }
  return [];
}

/** Throws `ChannelInvariantError` when any rule is broken. */
export function assertChannelValid(violations: readonly ChannelViolation[]): void {
  if (violations.length > 0) throw new ChannelInvariantError(violations);
}

/** Exported for tests and for anything that needs to enumerate the statuses. */
export const ALL_STATUSES: readonly ChannelStatus[] = CHANNEL_STATUSES;
