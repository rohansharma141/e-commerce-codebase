/**
 * The product page's metadata in a channel the api will not answer (C-19d).
 *
 * Metadata is resolved separately from rendering, so it runs even when the
 * layout has already decided the page will not render — and Next swallows a
 * `generateMetadata` that throws. `/de/p/<id>` came back `200`, with the
 * market-closed message in the body and *no* title and *no* robots tag in the
 * head: the `noindex` the segment sets was lost, silently. Nothing errored.
 */
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('@/lib/tenant', () => ({ getTenantId: () => 't-fashion' }));

let lookup: unknown = { status: 'ok', channel: { key: 'uk' } };
jest.mock('@/lib/channel', () => ({
  lookupChannel: async () => lookup,
  channelHref: (path: string) => path,
  getChannelKey: () => null,
}));

const graphqlQuery = jest.fn();
jest.mock('@/lib/api-graphql', () => ({
  ...jest.requireActual('@/lib/api-graphql'),
  graphqlQuery: (...args: unknown[]) => graphqlQuery(...args),
}));

import { generateMetadata } from './page';

describe('product page metadata', () => {
  beforeEach(() => {
    graphqlQuery.mockReset();
    graphqlQuery.mockResolvedValue({ product: { name: 'Awesome Bacon' } });
    lookup = { status: 'ok', channel: { key: 'uk' } };
  });

  it('titles the page from the product', async () => {
    await expect(generateMetadata({ params: { id: 'p-1' } })).resolves.toEqual({
      title: 'Awesome Bacon',
    });
  });

  it('asks nothing of the api in a channel it refuses, leaving the segment noindex to stand', async () => {
    lookup = { status: 'unservable' };

    await expect(generateMetadata({ params: { id: 'p-1' } })).resolves.toEqual({});
    expect(graphqlQuery).not.toHaveBeenCalled();
  });

  it('asks nothing for an unknown channel either', async () => {
    lookup = { status: 'unknown' };

    await expect(generateMetadata({ params: { id: 'p-1' } })).resolves.toEqual({});
    expect(graphqlQuery).not.toHaveBeenCalled();
  });
});
