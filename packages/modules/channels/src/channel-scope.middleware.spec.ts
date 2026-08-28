import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { currentTenant, runWithTenant } from '@platform/shared/tenant-context';
import type { ChannelConfig } from '@platform/modules/channels/contracts';
import { ChannelScopeMiddleware } from './channel-scope.middleware';
import type { ChannelsService } from './channels.service';

/**
 * Channel resolution and binding (C-12).
 *
 * **These run.** The branch that matters — absent versus unknown — is pure
 * logic, and conflating the two is the failure the whole scope design is
 * arranged against, so it is tested directly rather than inferred from an HTTP
 * round trip that has not happened.
 *
 * Not covered here, and needing a database: that `findByKey` actually excludes
 * archived and cross-tenant rows. That is asserted in
 * `channels.integration.spec.ts`, which has never run. The fake below *assumes*
 * findByKey behaves correctly; these tests check what the middleware does with
 * its answer, which is a different question and the one it owns.
 */

const config = (key: string): ChannelConfig =>
  ({
    channelId: `id-${key}`,
    tenantId: 't1',
    key,
    name: key,
    status: 'active',
    isDefault: false,
    currencyCode: 'GBP',
    currencyMinorUnits: 2,
    defaultLocale: 'en-GB',
    supportedLocales: ['en-GB'],
    country: 'GB',
    timezone: 'Europe/London',
    taxDisplay: 'net',
    taxRateBps: 2000,
  }) as ChannelConfig;

const service = (known: Record<string, ChannelConfig | null>): ChannelsService =>
  ({
    findByKey: async (_t: string, key: string) => known[key] ?? null,
  }) as unknown as ChannelsService;

const request = (headers: Record<string, string>): Request =>
  ({ headers }) as unknown as Request;

const run = async (
  mw: ChannelScopeMiddleware,
  headers: Record<string, string>,
): Promise<{ called: boolean; channelKey?: string; channelId?: string }> =>
  runWithTenant({ tenantId: 't1', requestId: 'r1' }, async () => {
    let called = false;
    await mw.use(request(headers), {} as Response, () => {
      called = true;
    });
    const ctx = currentTenant();
    return { called, channelKey: ctx?.channelKey, channelId: ctx?.channelId };
  });

describe('absent versus unknown', () => {
  it('no header: continues, and binds nothing', async () => {
    // Absent is not an error. Consumers fall back to the tenant default, which
    // is what keeps the shipped storefront working unchanged.
    const mw = new ChannelScopeMiddleware(service({}));
    const out = await run(mw, { 'x-tenant-id': 't1' });
    expect(out.called).toBe(true);
    expect(out.channelKey).toBeUndefined();
    expect(out.channelId).toBeUndefined();
  });

  it('an empty or whitespace header is treated as absent, not as a bad key', async () => {
    const mw = new ChannelScopeMiddleware(service({}));
    for (const value of ['', '   ']) {
      const out = await run(mw, { 'x-tenant-id': 't1', 'x-channel-id': value });
      expect(out.called).toBe(true);
      expect(out.channelKey).toBeUndefined();
    }
  });

  it('an unknown channel is a 404, NOT a fallback to the default', async () => {
    // The whole point. A fallback here means a typo serves another market's
    // prices and looks like it worked.
    const mw = new ChannelScopeMiddleware(service({ uk: config('uk') }));
    await expect(
      run(mw, { 'x-tenant-id': 't1', 'x-channel-id': 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not call next() when it rejects', async () => {
    // A middleware that threw *and* continued would serve the request
    // unscoped, which is the fallback it just refused.
    const mw = new ChannelScopeMiddleware(service({}));
    let called = false;
    await expect(
      runWithTenant({ tenantId: 't1', requestId: 'r1' }, async () => {
        await mw.use(request({ 'x-tenant-id': 't1', 'x-channel-id': 'x' }), {} as Response, () => {
          called = true;
        });
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(called).toBe(false);
  });
});

describe('binding', () => {
  it('binds both the id and the key onto the existing context', async () => {
    // One AsyncLocalStorage, a field on the existing context — not a parallel
    // mechanism. The id is what other modules store; the key is what appears
    // in URLs and cache tags, so both are carried.
    const mw = new ChannelScopeMiddleware(service({ de: config('de') }));
    const out = await run(mw, { 'x-tenant-id': 't1', 'x-channel-id': 'de' });
    expect(out.called).toBe(true);
    expect(out.channelKey).toBe('de');
    expect(out.channelId).toBe('id-de');
  });

  it('trims the header, so a stray space does not 404', async () => {
    const mw = new ChannelScopeMiddleware(service({ de: config('de') }));
    const out = await run(mw, { 'x-tenant-id': 't1', 'x-channel-id': '  de  ' });
    expect(out.channelKey).toBe('de');
  });

  it('resolves against the tenant from the request, not a hardcoded one', async () => {
    // Guards the case where channel lookup ignores the tenant and finds a key
    // belonging to someone else. The fake records what it was asked.
    const seen: string[] = [];
    const svc = {
      findByKey: async (t: string, key: string) => {
        seen.push(t);
        return key === 'de' ? config('de') : null;
      },
    } as unknown as ChannelsService;
    const mw = new ChannelScopeMiddleware(svc);
    await run(mw, { 'x-tenant-id': 't1', 'x-channel-id': 'de' });
    expect(seen).toEqual(['t1']);
  });

  it('fails loudly if channel resolution runs outside a tenant context', async () => {
    // "Unreachable in the wired chain" is a claim about middleware order that a
    // future reorder could falsify silently, leaving every request unscoped
    // while looking scoped.
    const mw = new ChannelScopeMiddleware(service({ de: config('de') }));
    await expect(
      mw.use(request({ 'x-channel-id': 'de' }), {} as Response, () => undefined),
    ).rejects.toThrow(/tenant/i);
  });
});
