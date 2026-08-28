import { BadRequestException } from '@nestjs/common';
import type { ResolvedChannel } from '@platform/modules/channels/contracts';
import { ChannelsController } from './channels.controller';

/**
 * The two pieces of controller logic that are not just delegation, and are
 * therefore the two most likely to be wrong. Both are pure, so these run.
 *
 * Everything else on the controller forwards to `ChannelsService`, whose guards
 * are covered by `channels.service.spec.ts`. What is NOT covered anywhere that
 * has actually executed: that any of it works over HTTP against a real
 * database. That needs `admin-conventions.integration.spec.ts` and Docker.
 */

// The methods under test are private-by-convention statics; reaching them
// directly is deliberate. Extracting them to a module to make them "properly"
// testable would spread two small functions across two files for no gain.
const asAny = ChannelsController as unknown as {
  expectedVersion(ifMatch: string | undefined): number;
  present(r: ResolvedChannel): { config: unknown; inherited: readonly string[] };
};

describe('If-Match parsing', () => {
  it('rejects a missing precondition rather than writing unconditionally', () => {
    // The failure this prevents: treating an absent If-Match as "no
    // precondition" means optimistic concurrency quietly stops applying to the
    // one client that forgot it — which is the client that overwrites someone
    // else's edit.
    expect(() => asAny.expectedVersion(undefined)).toThrow(BadRequestException);
    expect(() => asAny.expectedVersion('')).toThrow(BadRequestException);
  });

  it.each([
    ['3', 3],
    ['"3"', 3], // a quoted ETag, which is what a browser sends back
    ['W/"3"', 3], // a weak ETag
    ['  7  ', 7],
  ])('parses %p as %i', (header, expected) => {
    expect(asAny.expectedVersion(header)).toBe(expected);
  });

  it.each(['abc', '"abc"', 'v3', '*'])('rejects the unparseable %p', (header) => {
    // `*` matters: it is a legal If-Match value meaning "any current
    // representation", and silently accepting it would be an unconditional
    // write wearing a precondition's clothes.
    expect(() => asAny.expectedVersion(header)).toThrow(BadRequestException);
  });

  it('accepts version 0 rather than treating it as absent', () => {
    // A falsy-check bug: `if (!parsed)` would reject a legitimate version 0.
    expect(asAny.expectedVersion('0')).toBe(0);
  });
});

describe('inherited fields on the wire', () => {
  const resolved = (inherited: string[]): ResolvedChannel =>
    ({
      config: { key: 'uk' },
      inherited: new Set(inherited),
    }) as unknown as ResolvedChannel;

  it('converts the Set to an array, because JSON.stringify(Set) is {}', () => {
    // The whole reason this conversion exists. Without it the back office
    // receives `"inherited": {}` and cannot distinguish an inherited field from
    // an overridden one — the two look identical in `config`.
    const out = asAny.present(resolved(['country', 'timezone']));
    expect(Array.isArray(out.inherited)).toBe(true);
    expect([...out.inherited].sort()).toEqual(['country', 'timezone']);
  });

  it('survives a JSON round trip with the field intact', () => {
    // Asserting on the serialised form, not the object: the bug being guarded
    // against only appears after stringify.
    const out = JSON.parse(JSON.stringify(asAny.present(resolved(['country']))));
    expect(out.inherited).toEqual(['country']);
  });

  it('an empty set becomes an empty array, not an empty object', () => {
    const out = JSON.parse(JSON.stringify(asAny.present(resolved([]))));
    expect(out.inherited).toEqual([]);
  });
});
