import { Module, type ExecutionContext } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { currentTenant } from '@platform/shared/tenant-context';
import type { Request } from 'express';

/**
 * Per-tenant rate-limit configuration. We extend the default ThrottlerGuard
 * to key by tenant id (from ALS, set by TenantMiddleware) rather than the
 * default IP-based tracker. Two named throttlers:
 *   - 'default': 200 req/min — generous floor for any tenant route
 *   - 'storefront': 60 req/min — applies via @Throttle({ storefront: ... })
 *     on cart/checkout controllers
 *
 * GraphQL contexts skipped: Apollo's response object doesn't expose Express's
 * `res.header()` method that the throttler uses to write rate-limit headers,
 * so applying it to GraphQL crashes the resolver. The api's GraphQL surface
 * is read-only search; rate-limit at the gateway layer for that surface.
 */
const TENANT_GUARD = class extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<string>() !== 'http') return true;
    return super.canActivate(context);
  }

  protected override getTracker(req: Request): Promise<string> {
    const tenant = currentTenant();
    if (tenant) return Promise.resolve(`t:${tenant.tenantId}`);
    return Promise.resolve(req.ip ?? 'unknown');
  }
};

export const throttlerConfig: ThrottlerModuleOptions = [
  { name: 'default', ttl: 60_000, limit: 200 },
  { name: 'storefront', ttl: 60_000, limit: 60 },
];

@Module({
  imports: [ThrottlerModule.forRoot(throttlerConfig)],
  providers: [{ provide: APP_GUARD, useClass: TENANT_GUARD }],
})
export class PlatformThrottlerModule {}
