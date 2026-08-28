import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  readonly tenantId: string;
  readonly userId?: string;
  readonly requestId: string;

  /**
   * The channel this request is scoped to, once resolved.
   *
   * Two plain strings rather than a resolved `ChannelConfig`, and that is a
   * boundary constraint rather than a preference: `scope:shared` may only
   * depend on `scope:shared`, so this package cannot name a type from the
   * channels contracts. Anything needing the resolved configuration asks the
   * channels module for it — an in-process call, not a second source of truth.
   *
   * Mutable, unlike everything above, because resolution happens in a later
   * middleware than the one that creates this context: the channel lookup needs
   * the tenant-bound database connection, which is bound after the tenant
   * itself. `bindChannel` is the only supported way to set them, so the
   * mutation has exactly one place to look for.
   *
   * Both undefined means the request named no channel. That is not an error —
   * consumers fall back to the tenant default (ADR-0014 §8), a fallback which
   * carries a stated expiry precisely so it does not become permanent.
   */
  channelId?: string;
  channelKey?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Records the resolved channel on the current context.
 *
 * The single supported mutation point, so "who set this" has one answer. It
 * throws rather than no-opping when nothing is bound: a channel resolved
 * outside a request context is a wiring mistake, and silently dropping it would
 * leave every downstream consumer falling back to the tenant default while the
 * request looked scoped.
 */
export function bindChannel(channelId: string, channelKey: string): void {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant context bound; cannot bind a channel. Channel resolution must run ' +
        'inside runWithTenant(), after TenantMiddleware.',
    );
  }
  ctx.channelId = channelId;
  ctx.channelKey = channelKey;
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
