import { BadRequestException } from '@nestjs/common';
import { currentTenant, currentTenantOrThrow, runWithTenant } from './tenant-context';
import { TenantMiddleware } from './tenant.middleware';

describe('tenant-context', () => {
  it('returns undefined outside a tenant scope', () => {
    expect(currentTenant()).toBeUndefined();
  });

  it('binds context for the duration of runWithTenant', () => {
    const result = runWithTenant(
      { tenantId: 'tenant-x', requestId: 'req-1' },
      () => currentTenantOrThrow().tenantId,
    );
    expect(result).toBe('tenant-x');
    expect(currentTenant()).toBeUndefined();
  });

  it('isolates context across concurrent async flows', async () => {
    const observed: string[] = [];
    const runFlow = (tenantId: string, delayMs: number) =>
      runWithTenant({ tenantId, requestId: tenantId }, async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        observed.push(currentTenantOrThrow().tenantId);
      });

    await Promise.all([runFlow('a', 20), runFlow('b', 10), runFlow('c', 5)]);
    expect(observed.sort()).toEqual(['a', 'b', 'c']);
  });

  it('throws if currentTenantOrThrow is called outside scope', () => {
    expect(() => currentTenantOrThrow()).toThrow(/tenant context/i);
  });
});

describe('TenantMiddleware', () => {
  const mw = new TenantMiddleware();

  const makeReq = (headers: Record<string, string | undefined> = {}) =>
    ({ headers } as unknown as Parameters<TenantMiddleware['use']>[0]);
  const res = {} as Parameters<TenantMiddleware['use']>[1];

  it('rejects requests without a tenant header', () => {
    expect(() => mw.use(makeReq(), res, () => undefined)).toThrow(BadRequestException);
  });

  it('rejects requests with empty tenant header', () => {
    expect(() => mw.use(makeReq({ 'x-tenant-id': '   ' }), res, () => undefined)).toThrow(
      BadRequestException,
    );
  });

  it('binds the tenant inside the next() call', () => {
    let observedTenant: string | undefined;
    mw.use(makeReq({ 'x-tenant-id': 'tenant-7' }), res, () => {
      observedTenant = currentTenantOrThrow().tenantId;
    });
    expect(observedTenant).toBe('tenant-7');
  });

  it('reuses an inbound x-request-id and generates one otherwise', () => {
    let observed: string | undefined;
    mw.use(makeReq({ 'x-tenant-id': 't', 'x-request-id': 'rid-99' }), res, () => {
      observed = currentTenantOrThrow().requestId;
    });
    expect(observed).toBe('rid-99');

    let generated: string | undefined;
    mw.use(makeReq({ 'x-tenant-id': 't' }), res, () => {
      generated = currentTenantOrThrow().requestId;
    });
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });
});
