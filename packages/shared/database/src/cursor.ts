import { BadRequestException } from '@nestjs/common';

/**
 * Opaque cursor tokens for keyset pagination.
 *
 * Cursors are base64url-encoded JSON arrays of the sort-key values of the last
 * row on a page. Two properties matter, and both are why they are encoded
 * rather than passed raw:
 *
 *  1. **Opacity.** A client that parses a cursor is a client that breaks when
 *     the sort key changes. `/admin/orders` already needs two components
 *     (`created_at`, `id`) because `created_at` is not unique — 99,004 price
 *     rows share 103 timestamps in the seeded data, and orders can tie the
 *     same way under load. Anything that pins the format forbids that.
 *  2. **A place to grow.** When channels land, a cursor may need to carry the
 *     channel it was issued for. That is an encoding change here, not an API
 *     change for every consumer.
 *
 * They are NOT signed or encrypted. A caller can decode one and see a row's
 * sort key, which is not sensitive: they already have the row. Tenant
 * isolation does not rest on cursor opacity — RLS rejects a cursor pointing at
 * another tenant's row because the query never sees that row in the first
 * place.
 */

/** Thrown as a 400 rather than swallowed: a bad cursor is a client error. */
const invalid = (): never => {
  throw new BadRequestException('cursor is not a valid pagination token');
};

export function encodeCursor(parts: readonly string[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor into exactly `arity` string parts.
 *
 * Rejects rather than falling back to page one. Silently restarting is the
 * failure mode where a paginating client loops forever over the first page and
 * every individual response looks correct.
 */
export function decodeCursor(cursor: string, arity: number): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return invalid();
  }
  if (!Array.isArray(parsed) || parsed.length !== arity) return invalid();
  if (!parsed.every((p) => typeof p === 'string')) return invalid();
  return parsed as readonly string[];
}

/** Clamps a client-supplied `limit` into the range every admin list allows. */
export function clampLimit(limit: number | undefined, fallback = 50, max = 100): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

/**
 * Turns `limit + 1` fetched rows into a page plus the cursor for the next one.
 * Fetching one extra row is how "is there more?" is answered without a second
 * COUNT query that would disagree with the page under concurrent writes.
 */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => readonly string[],
): { items: readonly T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
  };
}
