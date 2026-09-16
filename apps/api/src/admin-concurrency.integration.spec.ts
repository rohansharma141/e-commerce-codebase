import { randomUUID } from 'node:crypto';

/**
 * Optimistic concurrency over HTTP (C-9).
 *
 * The repository-level check already exists in `channels.integration.spec.ts`
 * and passes: two writes with the same expected version, the second rejected.
 * That is not the same claim as this file's. Between the repository and a
 * client sit the `ETag` a read hands out, the `If-Match` a write sends back,
 * and the `409` body a client is expected to recover from — three places the
 * mechanism can be correct underneath and useless on the wire.
 *
 * ── What each assertion prints if the thing under test did nothing ────────
 *
 *   - "a read hands back an ETag"        — no ETag header; a client has nothing
 *                                          to send, so If-Match is unusable
 *   - "a stale If-Match is refused"      — 200, and the first operator's edit
 *                                          is gone with no trace
 *   - "the 409 carries currentVersion"   — a client must re-read to retry,
 *                                          turning one round trip into two
 *   - "a missing If-Match is refused"    — 200; the one client that forgets the
 *                                          header is the one that overwrites
 *                                          someone else silently
 *   - "the ETag matches the body's version" — an ETag from a different read
 *                                          than the payload, which is a 409 a
 *                                          correct client can never resolve
 *
 * Requires the seeded docker stack; skipped when TEST_API_URL is unset. See the
 * note in admin-conventions.integration.spec.ts about --skipNxCache and the
 * per-tenant request throttle.
 */

const API_URL = process.env['TEST_API_URL'];
const TENANT = process.env['TEST_TENANT_ID'] ?? 't-fashion';

const describeLive = API_URL ? describe : describe.skip;

jest.setTimeout(60_000);

interface ChannelBody {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly version: number;
}

async function req<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T; etag: string | null }> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': TENANT,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429) {
    throw new Error(`${path} returned 429 (rate limited). Wait a minute and re-run.`);
  }
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T,
    etag: res.headers.get('etag'),
  };
}

describeLive('optimistic concurrency on the wire', () => {
  /**
   * A disposable draft per test.
   *
   * Drafts rather than the seeded `uk`/`de`: these tests mutate, and a suite
   * that edits demo fixtures leaves the stack in a state the next reader has to
   * guess at. A draft is also the one status where `key` and everything else
   * is freely editable, so a rejection here is about concurrency rather than an
   * invariant firing for an unrelated reason.
   */
  const makeDraft = async (): Promise<ChannelBody> => {
    const key = `probe-${randomUUID().slice(0, 8)}`;
    const { status, body } = await req<ChannelBody>('/admin/channels', {
      method: 'POST',
      body: JSON.stringify({ key, name: 'Concurrency probe' }),
    });
    expect(status).toBe(201);
    return body;
  };

  it('a read hands back an ETag a client can send straight back', async () => {
    const created = await makeDraft();
    const { status, etag } = await req<unknown>(`/admin/channels/${created.id}`);
    expect(status).toBe(200);
    expect(etag).toBe(String(created.version));
  });

  it('the ETag describes the body it came with, not some other read', async () => {
    // Guards the torn-ETag bug: the handler used to fetch the body and the
    // version in two separate queries, so a write landing between them produced
    // an ETag for a different version than the payload.
    const created = await makeDraft();
    await req(`/admin/channels/${created.id}`, {
      method: 'PATCH',
      headers: { 'if-match': String(created.version) },
      body: JSON.stringify({ name: 'Renamed once' }),
    });

    const after = await req<{ config: { name: string } }>(`/admin/channels/${created.id}`);
    expect(after.status).toBe(200);
    expect(after.body.config.name).toBe('Renamed once');
    // The version handed out must be the one that produced this body, so
    // sending it straight back succeeds rather than conflicting.
    const retry = await req(`/admin/channels/${created.id}`, {
      method: 'PATCH',
      headers: { 'if-match': after.etag ?? '' },
      body: JSON.stringify({ name: 'Renamed twice' }),
    });
    expect(retry.status).toBe(200);
  });

  it('a stale If-Match is refused, so the first edit is not lost', async () => {
    // Without version checking both writes succeed and the first operator's
    // change vanishes with nothing to show it ever happened.
    const created = await makeDraft();
    const stale = String(created.version);

    const first = await req(`/admin/channels/${created.id}`, {
      method: 'PATCH',
      headers: { 'if-match': stale },
      body: JSON.stringify({ name: 'Operator A' }),
    });
    expect(first.status).toBe(200);

    const second = await req<Record<string, unknown>>(`/admin/channels/${created.id}`, {
      method: 'PATCH',
      headers: { 'if-match': stale },
      body: JSON.stringify({ name: 'Operator B' }),
    });
    expect(second.status).toBe(409);

    // And A's edit survived.
    const final = await req<{ config: { name: string } }>(`/admin/channels/${created.id}`);
    expect(final.body.config.name).toBe('Operator A');
  });

  it('the 409 carries currentVersion so a retry costs one round trip, not two', async () => {
    const created = await makeDraft();
    const stale = String(created.version);
    await req(`/admin/channels/${created.id}`, {
      method: 'PATCH',
      headers: { 'if-match': stale },
      body: JSON.stringify({ name: 'A' }),
    });

    const conflict = await req<Record<string, unknown>>(`/admin/channels/${created.id}`, {
      method: 'PATCH',
      headers: { 'if-match': stale },
      body: JSON.stringify({ name: 'B' }),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body['statusCode']).toBe(409);
    expect(typeof conflict.body['currentVersion']).toBe('number');

    // The whole point of returning it: retrying with that value works, with no
    // intervening GET.
    const retry = await req(`/admin/channels/${created.id}`, {
      method: 'PATCH',
      headers: { 'if-match': String(conflict.body['currentVersion']) },
      body: JSON.stringify({ name: 'B' }),
    });
    expect(retry.status).toBe(200);
  });

  it('a write with no If-Match at all is refused', async () => {
    // An absent precondition treated as "no precondition" means optimistic
    // concurrency quietly stops applying to the one client that forgot it --
    // which is the client that overwrites someone else's edit.
    const created = await makeDraft();
    const { status } = await req(`/admin/channels/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'No precondition' }),
    });
    expect(status).toBe(400);
  });

  it('tenant defaults enforce the same contract', async () => {
    // The convention has to hold across the surface, not just on channels --
    // otherwise it is a channels feature wearing a convention's name.
    const read = await req<{ version: number }>('/admin/tenant-defaults');
    expect(read.status).toBe(200);
    expect(read.etag).toBe(String(read.body.version));

    const conflict = await req<Record<string, unknown>>('/admin/tenant-defaults', {
      method: 'PATCH',
      headers: { 'if-match': String(read.body.version - 1) },
      body: JSON.stringify({ country: 'GB' }),
    });
    expect(conflict.status).toBe(409);
    expect(typeof conflict.body['currentVersion']).toBe('number');
  });
});
