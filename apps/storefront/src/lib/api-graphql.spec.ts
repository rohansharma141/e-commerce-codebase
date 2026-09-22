/**
 * What the read path puts on the wire.
 *
 * These assertions look pedantic and are not. The storefront's whole caching
 * story rests on two properties of the outgoing request, and both were broken
 * at some point without anything failing:
 *
 *   1. It is a GET. Next's data cache stores GET responses only, and accepts
 *      `next: { tags, revalidate }` on a POST while ignoring it. When this was
 *      a POST, nothing was cached and every revalidateTag call in the webhook
 *      route silently invalidated nothing.
 *
 *   2. The tenant travels in a header on every request. Next includes request
 *      headers in the cache key, so the header is what stops two tenants
 *      sharing one entry for a byte-identical URL. Dropping it — or hoisting
 *      it out as an "optimisation", since the URL alone looks sufficient —
 *      would serve one tenant's catalogue to another.
 *
 * The cache-key behaviour itself belongs to Next and is verified by running
 * the stack: two tenants requesting the same page get their own data. What is
 * checked here is the part this repo controls, which is that the request
 * carries the tenant at all and does so per call.
 */
// `server-only` exists to fail the build if this module is imported from a
// client component. It has no jest resolution, so it is stubbed rather than
// removed — the guard it provides is worth more than the inconvenience.
jest.mock('server-only', () => ({}), { virtual: true });

import { GraphqlError, graphqlQuery } from './api-graphql';

let currentTenant = 't-fashion';
jest.mock('./tenant', () => ({
  getTenantId: () => currentTenant,
}));

const DOC = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'Probe' },
      variableDefinitions: [],
      directives: [],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'ok' }, arguments: [], directives: [] },
        ],
      },
    },
  ],
  // The generated documents are TypedDocumentNode; the shape above is all that
  // `print()` needs, and typing it as never keeps the cast honest about that.
} as never;

function mockFetch(body: unknown, status = 200): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('graphqlQuery', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads over GET, because the data cache does not store POST responses', async () => {
    const fetchMock = mockFetch({ data: { ok: true } });

    await graphqlQuery(DOC, {}, { tags: ['browse:t-fashion'] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // `undefined` counts: fetch defaults to GET. What must never appear is POST.
    expect(init.method ?? 'GET').toBe('GET');
    expect(url).toContain('/graphql?');
    expect(url).toContain('query=');
  });

  it('sends the tenant as a header on every call, not once', async () => {
    const fetchMock = mockFetch({ data: { ok: true } });

    currentTenant = 't-fashion';
    await graphqlQuery(DOC, {}, { tags: ['browse:t-fashion'] });
    currentTenant = 't-electronics';
    await graphqlQuery(DOC, {}, { tags: ['browse:t-electronics'] });

    const headersOf = (i: number) =>
      ((fetchMock.mock.calls[i] as [string, RequestInit])[1].headers ?? {}) as Record<
        string,
        string
      >;

    expect(headersOf(0)['x-tenant-id']).toBe('t-fashion');
    expect(headersOf(1)['x-tenant-id']).toBe('t-electronics');

    // Same question, so the URLs are identical. The header is the ONLY thing
    // separating these two cache entries — which is the point of the test.
    const urlOf = (i: number) => (fetchMock.mock.calls[i] as [string])[0];
    expect(urlOf(0)).toBe(urlOf(1));
  });

  it('asks Apollo to allow the GET', async () => {
    const fetchMock = mockFetch({ data: { ok: true } });

    await graphqlQuery(DOC, {}, { tags: ['x'] });

    const headers = ((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers ??
      {}) as Record<string, string>;
    // Without this Apollo answers 400 and every page fails to render.
    expect(headers['apollo-require-preflight']).toBe('true');
  });

  it('passes the caller tags and revalidate through to the data cache', async () => {
    const fetchMock = mockFetch({ data: { ok: true } });

    await graphqlQuery(DOC, {}, { tags: ['browse:t-fashion:category:shoes'], revalidate: 30 });

    const init = (fetchMock.mock.calls[0] as [string, RequestInit & { next?: unknown }])[1];
    expect((init as { next: { tags: string[]; revalidate: number } }).next).toEqual({
      tags: ['browse:t-fashion:category:shoes'],
      revalidate: 30,
    });
  });

  it('surfaces api errors rather than caching a broken render', async () => {
    mockFetch({ errors: [{ message: 'boom' }] });

    await expect(graphqlQuery(DOC, {}, { tags: ['x'] })).rejects.toBeInstanceOf(GraphqlError);
  });

  it('keeps the status of a refused request, so a 404 can be told from a failure', async () => {
    mockFetch({ message: 'no active channel' }, 404);

    // `resolveChannel` turns exactly this into the storefront's own 404. With
    // the status dropped, an unknown channel would render as a server error.
    await expect(graphqlQuery(DOC, {}, { channelKey: 'nope' })).rejects.toMatchObject({
      name: 'GraphqlError',
      status: 404,
    });
  });
});

describe('graphqlQuery channel scope (C-19a)', () => {
  const callOf = (fetchMock: jest.Mock) => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { path: new URL(url).pathname, headers: (init.headers ?? {}) as Record<string, string> };
  };

  beforeEach(() => {
    currentTenant = 't-fashion';
  });

  it('names the channel in both the URL and the header', async () => {
    const fetchMock = mockFetch({ data: { ok: true } });

    await graphqlQuery(DOC, {}, { channelKey: 'trade' });

    // The api refuses a channel URL without the matching header (C-2b), and a
    // cache keys on the URL alone, so dropping either half is a bug: the first
    // fails every scoped read, the second lets channels share cache entries.
    const { path, headers } = callOf(fetchMock);
    expect(path).toBe('/api/t-fashion/trade/graphql');
    expect(headers['x-channel-id']).toBe('trade');
    expect(headers['x-tenant-id']).toBe('t-fashion');
  });

  it('stays on the unscoped path when no channel is named', async () => {
    const fetchMock = mockFetch({ data: { ok: true } });

    await graphqlQuery(DOC, {}, { channelKey: null });

    const { path, headers } = callOf(fetchMock);
    expect(path).toBe('/graphql');
    expect(headers['x-channel-id']).toBeUndefined();
  });

  it('sends the key exactly as the path carried it, so URL and header agree byte for byte', async () => {
    const fetchMock = mockFetch({ data: { ok: true } });

    // A key outside the channel grammar has to reach the api intact, where it
    // is a 404. Encoding the URL half again would make it `%2574rade` against
    // a header of `%74rade`: a mismatch 400, and a server error here.
    await graphqlQuery(DOC, {}, { channelKey: '%74rade' });

    const { path, headers } = callOf(fetchMock);
    expect(path).toBe('/api/t-fashion/%74rade/graphql');
    expect(headers['x-channel-id']).toBe('%74rade');
  });
});
