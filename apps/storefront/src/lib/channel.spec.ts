/**
 * How the api's answer about a channel becomes one of three outcomes (C-19d).
 *
 * The distinction is the whole point: an unknown key must be a `404` and never
 * the default channel, a channel the price list cannot serve must say so
 * rather than fail, and anything else must still fail — a fault that read as a
 * closed market would hide every outage behind a polite message.
 */
jest.mock('server-only', () => ({}), { virtual: true });

let pathChannel: string | null = null;
jest.mock('./channel-key', () => ({
  getChannelKey: () => pathChannel,
  requestChannelKey: async () => pathChannel,
}));
jest.mock('./tenant', () => ({ getTenantId: () => 't-fashion' }));

let answer: () => unknown;
jest.mock('./api-graphql', () => ({
  ...jest.requireActual('./api-graphql'),
  graphqlQuery: async () => answer(),
}));

import { GraphqlError } from './api-graphql';
import { ApiError } from './api-rest';
import { lookupChannel } from './channel';

const CHANNEL = { key: 'uk', name: 'United Kingdom', isDefault: true };
const ok = () => ({ capabilities: { channel: CHANNEL } });
const throws = (err: unknown) => () => {
  throw err;
};

describe('lookupChannel', () => {
  beforeEach(() => {
    pathChannel = null;
    answer = ok;
  });

  it('reports the channel the api served the request in', async () => {
    await expect(lookupChannel()).resolves.toEqual({ status: 'ok', channel: CHANNEL });
  });

  it('reports a tenant with no channel at all as ok, with none', async () => {
    answer = () => ({ capabilities: { channel: null } });

    await expect(lookupChannel()).resolves.toEqual({ status: 'ok', channel: null });
  });

  it('reports a key the path named and the api does not know as unknown', async () => {
    pathChannel = 'xx';
    answer = throws(new GraphqlError('HTTP 404', null, 404));

    await expect(lookupChannel()).resolves.toEqual({ status: 'unknown' });
  });

  it('rethrows a 404 when the path named no channel: the default cannot be missing', async () => {
    // The default's key came from the api a moment earlier. A 404 for it is a
    // fault — reporting it as "unknown channel" would render a 404 page for
    // what is actually a broken deployment.
    answer = throws(new GraphqlError('HTTP 404', null, 404));

    await expect(lookupChannel()).rejects.toBeInstanceOf(GraphqlError);
  });

  it('reports a channel the price list cannot serve as unservable', async () => {
    pathChannel = 'de';
    answer = throws(new GraphqlError('HTTP 422', null, 422));

    await expect(lookupChannel()).resolves.toEqual({ status: 'unservable' });
  });

  it('reports an unservable default too, where the refusal comes from discovery', async () => {
    // On an unprefixed page the 422 arrives as an ApiError from
    // `/system/capabilities`, before any query is built. Matching only
    // GraphqlError would turn the whole storefront of such a tenant into a 500.
    answer = throws(new ApiError(422, '/system/capabilities', 'channel.unservable'));

    await expect(lookupChannel()).resolves.toEqual({ status: 'unservable' });
  });

  it('rethrows anything else, so an outage is not shown as a closed market', async () => {
    answer = throws(new GraphqlError('HTTP 500', null, 500));

    await expect(lookupChannel()).rejects.toBeInstanceOf(GraphqlError);
  });
});
