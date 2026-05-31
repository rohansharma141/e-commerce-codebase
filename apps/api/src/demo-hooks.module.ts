import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { HOOK_NAMES, HookRegistry } from '@platform/shared/hooks';

/**
 * Demo handlers for the two extension points the platform publishes today.
 * Observer-only — these don't transform the payload. Their job is to make
 * the hook firing visible in the api logs so a reviewer can grep for
 * `[demo-hook]` to confirm the customisation pattern actually runs in
 * production-shape code paths.
 *
 * In a real deployment these registrations would live in tenant-specific
 * plugins loaded at startup; see docs/adr/0009 for the design.
 */
@Module({})
export class DemoHooksModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('demo-hook');

  constructor(private readonly hooks: HookRegistry) {}

  onApplicationBootstrap(): void {
    this.hooks.register<{ subtotalCents: number; grandTotalCents: number }>(
      HOOK_NAMES.OrderBeforeCreate,
      (payload, ctx) => {
        this.logger.log(
          `${HOOK_NAMES.OrderBeforeCreate} tenant=${ctx.tenantId} ` +
            `req=${ctx.requestId} subtotal=${payload.subtotalCents} grand=${payload.grandTotalCents}`,
        );
      },
    );

    this.hooks.register<{ id: string; sku: string }>(
      HOOK_NAMES.ProductAfterCreate,
      (payload, ctx) => {
        this.logger.log(
          `${HOOK_NAMES.ProductAfterCreate} tenant=${ctx.tenantId} ` +
            `req=${ctx.requestId} sku=${payload.sku}`,
        );
      },
    );
  }
}
