import { Global, Module } from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';

/**
 * Provides TenantMiddleware. Composition of middleware order is the caller's
 * job (in apps/api/src/app.module.ts): TenantMiddleware MUST run before any
 * middleware that reads the tenant via currentTenantOrThrow() — notably
 * TenantBindingMiddleware from @platform/shared/database.
 *
 * forRoot() is kept as a no-op constructor for backward-compatible call sites;
 * options like excludeRoutes used to live here, but they belong with the
 * middleware-registration in the host app where ordering is settled anyway.
 */
@Global()
@Module({
  providers: [TenantMiddleware],
  exports: [TenantMiddleware],
})
export class TenantContextModule {
  static forRoot(): typeof TenantContextModule {
    return TenantContextModule;
  }
}
