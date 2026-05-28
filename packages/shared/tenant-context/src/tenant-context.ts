import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  readonly tenantId: string;
  readonly userId?: string;
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

export function currentTenantOrThrow(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant context bound. Code that touches tenant-scoped data must run inside runWithTenant().',
    );
  }
  return ctx;
}
