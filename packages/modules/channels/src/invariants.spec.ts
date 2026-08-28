import {
  ALL_STATUSES,
  ChannelInvariantError,
  assertChannelValid,
  canTransition,
  isValidChannelKey,
  validateChannelUpdate,
  validatePromoteDefault,
  type Channel,
  type ChannelStatus,
  type ChannelViolationCode,
} from '@platform/modules/channels/contracts';

/**
 * Every rule is tested by **attempting the violation**, not by confirming that
 * a legal operation succeeds. A suite of happy paths cannot distinguish an
 * enforced invariant from an absent one.
 *
 * Each `rejects` test is paired with an `allows` test wherever the rule is
 * conditional, so a validator that simply refuses everything fails too.
 */

const base: Channel = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 't-fashion',
  key: 'uk',
  name: 'United Kingdom',
  status: 'active',
  isDefault: false,
  hasTransacted: false,
  version: 1,
  currencyCode: 'GBP',
  defaultLocale: null,
  supportedLocales: null,
  country: null,
  timezone: null,
  taxDisplay: null,
  taxRateBps: null,
  externalRef: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
};

const channel = (over: Partial<Channel> = {}): Channel => ({ ...base, ...over });

/** Two active channels, so the "last active channel" rule is not what fires. */
const ctx = { activeChannelCount: 2 };

const codes = (vs: readonly { code: ChannelViolationCode }[]): ChannelViolationCode[] =>
  vs.map((v) => v.code);

describe('channel key', () => {
  it.each(['uk', 'de', 'us-east', 'a', 'store-1', 'a1'])('accepts %p', (k) => {
    expect(isValidChannelKey(k)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['UK', 'uppercase — URLs compare case-sensitively'],
    ['-uk', 'leading hyphen'],
    ['uk-', 'trailing hyphen'],
    ['u k', 'space'],
    ['uk/de', 'path separator — would split the URL segment'],
    ['uk?x', 'query delimiter'],
    ['uk.de', 'dot'],
    ['ük', 'non-ascii — would need percent-encoding'],
    ['a'.repeat(65), 'over 64 chars'],
  ])('rejects %p (%s)', (k) => {
    expect(isValidChannelKey(k)).toBe(false);
  });

  it('accepts exactly 64 characters', () => {
    expect(isValidChannelKey('a'.repeat(64))).toBe(true);
  });

  it('rejects a rename once the channel has left draft', () => {
    const vs = validateChannelUpdate(channel({ status: 'active' }), { key: 'gb' }, ctx);
    expect(codes(vs)).toContain('key.immutable');
  });

  it('allows a rename while still draft', () => {
    // The paired positive. Without it, a validator that rejected every key
    // change would pass the test above.
    const vs = validateChannelUpdate(channel({ status: 'draft' }), { key: 'gb' }, ctx);
    expect(vs).toEqual([]);
  });

  it('allows re-sending the same key on a live channel', () => {
    // A back office PUTting back the whole object must not trip immutability
    // just for including an unchanged field.
    const vs = validateChannelUpdate(channel({ status: 'active' }), { key: 'uk' }, ctx);
    expect(vs).toEqual([]);
  });

  it('rejects a malformed key even while draft', () => {
    const vs = validateChannelUpdate(channel({ status: 'draft' }), { key: 'UK!' }, ctx);
    expect(codes(vs)).toContain('key.invalid-format');
  });
});

describe('currency', () => {
  it('rejects a change once the channel has transacted', () => {
    const vs = validateChannelUpdate(
      channel({ hasTransacted: true, currencyCode: 'GBP' }),
      { currencyCode: 'EUR' },
      ctx,
    );
    expect(codes(vs)).toContain('currency.frozen');
  });

  it('allows a change before it has transacted', () => {
    const vs = validateChannelUpdate(
      channel({ hasTransacted: false, currencyCode: 'GBP' }),
      { currencyCode: 'EUR' },
      ctx,
    );
    expect(vs).toEqual([]);
  });

  it('allows re-sending the same currency on a transacted channel', () => {
    const vs = validateChannelUpdate(
      channel({ hasTransacted: true, currencyCode: 'GBP' }),
      { currencyCode: 'GBP' },
      ctx,
    );
    expect(vs).toEqual([]);
  });

  it('rejects a currency this deployment does not support', () => {
    // The reason the allowlist exists: minorUnitsFor cannot tell a typo from a
    // real currency, because Intl reports 2 decimals for anything well-formed.
    const vs = validateChannelUpdate(channel(), { currencyCode: 'XYZ' }, ctx);
    expect(codes(vs)).toContain('currency.unsupported');
  });

  it('respects a deployment-supplied allowlist', () => {
    const vs = validateChannelUpdate(channel(), { currencyCode: 'CHF' }, {
      ...ctx,
      supportedCurrencies: ['GBP', 'CHF'],
    });
    expect(vs).toEqual([]);
  });

  it('reports BOTH problems when a transacted channel is given a bad currency', () => {
    // Violations accumulate. Returning only the first turns one round trip
    // into several for a back office editing a whole channel in one form.
    const vs = validateChannelUpdate(
      channel({ hasTransacted: true }),
      { currencyCode: 'XYZ' },
      ctx,
    );
    expect(codes(vs).sort()).toEqual(['currency.frozen', 'currency.unsupported']);
  });

  it('allows clearing the override back to inherit, even after transacting', () => {
    // null means "resume inheriting", not "change currency". The tenant default
    // is validated in its own right.
    const vs = validateChannelUpdate(
      channel({ hasTransacted: true }),
      { currencyCode: null },
      ctx,
    );
    expect(vs).toEqual([]);
  });
});

describe('status transitions', () => {
  it.each([
    ['draft', 'active'],
    ['draft', 'archived'],
    ['active', 'archived'],
    ['archived', 'active'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each(['active', 'archived'] as const)('forbids %s → draft', (from) => {
    // The rule that protects another rule: returning to draft would unfreeze
    // `key`, making its immutability circumventable by archive-and-redraft.
    expect(canTransition(from, 'draft')).toBe(false);
  });

  it('reports returning to draft with its own code, not a generic one', () => {
    const vs = validateChannelUpdate(channel({ status: 'active' }), { status: 'draft' }, ctx);
    expect(codes(vs)).toContain('status.no-return-to-draft');
  });

  it('every status can stay where it is', () => {
    for (const s of ALL_STATUSES) {
      expect(canTransition(s, s)).toBe(true);
    }
  });

  it('the transition table covers every status pair', () => {
    // Guards against a status being added later with no transitions defined,
    // which would throw on `ALLOWED_TRANSITIONS[from]` rather than reject.
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(typeof canTransition(from as ChannelStatus, to as ChannelStatus)).toBe(
          'boolean',
        );
      }
    }
  });
});

describe('archiving', () => {
  it('rejects archiving the default channel', () => {
    const vs = validateChannelUpdate(
      channel({ isDefault: true }),
      { status: 'archived' },
      ctx,
    );
    expect(codes(vs)).toContain('default.cannot-archive');
  });

  it('allows archiving a non-default channel', () => {
    const vs = validateChannelUpdate(
      channel({ isDefault: false }),
      { status: 'archived' },
      ctx,
    );
    expect(vs).toEqual([]);
  });

  it('rejects archiving the last active channel', () => {
    // A tenant with zero active channels resolves nothing, and the failure
    // would otherwise surface at the next request rather than here.
    const vs = validateChannelUpdate(channel({ status: 'active' }), { status: 'archived' }, {
      activeChannelCount: 1,
    });
    expect(codes(vs)).toContain('tenant.needs-one-active-channel');
  });

  it('allows archiving a draft even when no channel is active', () => {
    // A draft was never resolving requests, so removing it cannot strand the
    // tenant. Asserting this stops the count rule being written too broadly.
    const vs = validateChannelUpdate(channel({ status: 'draft' }), { status: 'archived' }, {
      activeChannelCount: 0,
    });
    expect(vs).toEqual([]);
  });
});

describe('promoting a default', () => {
  it('rejects promoting a draft channel', () => {
    const vs = validatePromoteDefault(channel({ status: 'draft' }));
    expect(codes(vs)).toContain('default.must-be-active');
  });

  it('rejects promoting an archived channel', () => {
    const vs = validatePromoteDefault(channel({ status: 'archived' }));
    expect(codes(vs)).toContain('default.must-be-active');
  });

  it('allows promoting an active channel', () => {
    expect(validatePromoteDefault(channel({ status: 'active' }))).toEqual([]);
  });
});

describe('omitted fields', () => {
  it('validates nothing when the patch is empty', () => {
    // PATCH merge semantics: an absent field is left alone. Validating omitted
    // fields would make a channel unresolvable if a newer rule forbade a state
    // it is already in.
    const vs = validateChannelUpdate(
      channel({ hasTransacted: true, status: 'archived', currencyCode: 'XYZ' }),
      {},
      { activeChannelCount: 0 },
    );
    expect(vs).toEqual([]);
  });

  it('validates a name-only patch without touching currency or status rules', () => {
    const vs = validateChannelUpdate(
      channel({ hasTransacted: true }),
      { name: 'UK & Ireland' },
      ctx,
    );
    expect(vs).toEqual([]);
  });
});

describe('assertChannelValid', () => {
  it('throws with every violation attached', () => {
    const vs = validateChannelUpdate(
      channel({ hasTransacted: true }),
      { currencyCode: 'XYZ' },
      ctx,
    );
    expect(() => assertChannelValid(vs)).toThrow(ChannelInvariantError);
    try {
      assertChannelValid(vs);
    } catch (e) {
      expect((e as ChannelInvariantError).violations).toHaveLength(2);
    }
  });

  it('does nothing when there are no violations', () => {
    expect(() => assertChannelValid([])).not.toThrow();
  });
});
