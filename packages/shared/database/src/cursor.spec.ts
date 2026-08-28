import { BadRequestException } from '@nestjs/common';
import { clampLimit, decodeCursor, encodeCursor, toPage } from './cursor';

describe('cursor codec', () => {
  it('round-trips the parts it was given', () => {
    const parts = ['2026-08-28T10:00:00.000Z', 'b0a1f2e3-0000-4000-8000-000000000001'];
    expect(decodeCursor(encodeCursor(parts), 2)).toEqual(parts);
  });

  it('produces a token that does not leak its contents in the clear', () => {
    // Not a security property — see the note in cursor.ts. This pins that the
    // token is encoded at all, so a client cannot come to depend on reading a
    // raw uuid out of it and break when the sort key gains a second component.
    const token = encodeCursor(['plain-value']);
    expect(token).not.toContain('plain-value');
  });

  it('is URL-safe, because cursors travel in query strings', () => {
    // base64 (as opposed to base64url) would emit '+' and '/', which a
    // querystring round-trip mangles into a space and a path separator.
    const token = encodeCursor(['2026-08-28T10:00:00.000Z?a=b&c=d/e+f']);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(new URLSearchParams({ cursor: token }).get('cursor')).toBe(token);
  });

  describe('rejects rather than restarting', () => {
    // Every one of these would otherwise return page one, which is the bug
    // where a paginating client loops over the first page forever and each
    // individual response looks perfectly healthy.
    it.each([
      ['not base64 at all', '!!!not-base64!!!'],
      ['base64 of non-JSON', Buffer.from('hello', 'utf8').toString('base64url')],
      ['a JSON object rather than an array', encodeCursorRaw({ id: 'x' })],
      ['an array of the wrong arity', encodeCursor(['a', 'b', 'c'])],
      ['an array holding a non-string', encodeCursorRaw([1, 2])],
    ])('%s', (_label, token) => {
      expect(() => decodeCursor(token, 2)).toThrow(BadRequestException);
    });
  });

  it('rejects a one-part cursor where two are expected', () => {
    expect(() => decodeCursor(encodeCursor(['only-one']), 2)).toThrow(BadRequestException);
  });
});

describe('clampLimit', () => {
  it.each([
    [undefined, 50],
    [Number.NaN, 50],
    [0, 1],
    [-5, 1],
    [10, 10],
    [10.7, 10],
    [1000, 100],
  ])('%p -> %p', (input, expected) => {
    expect(clampLimit(input as number | undefined)).toBe(expected);
  });
});

describe('toPage', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const cursorOf = (r: { id: string }): readonly string[] => [r.id];

  it('trims the probe row and issues a cursor from the last kept row', () => {
    const page = toPage(rows, 2, cursorOf);
    expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    // 'b' — the last row of the page — not 'c', the probe row that revealed
    // there is more. A cursor taken from the probe skips a row every page.
    expect(page.nextCursor).toBe(encodeCursor(['b']));
  });

  it('reports a null cursor on the final page', () => {
    const page = toPage(rows, 3, cursorOf);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it('reports a null cursor for an empty result', () => {
    const page = toPage([], 10, cursorOf);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

/** Encodes arbitrary JSON, to build the malformed tokens the codec must reject. */
function encodeCursorRaw(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
