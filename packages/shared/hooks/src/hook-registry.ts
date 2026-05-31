import { Injectable, Logger } from '@nestjs/common';

export interface HookContext {
  readonly tenantId: string;
  readonly requestId: string;
}

export type HookHandler<P> = (payload: P, ctx: HookContext) => Promise<void> | void;

/**
 * Typed extension-point registry. Handlers run sequentially and are
 * exception-isolated — a handler that throws is logged and the parent flow
 * continues. This is deliberate: the platform never breaks because of a
 * tenant's customization. Mutating dispatch (where a handler can return a
 * transformed payload) is documented in docs/adr/0009 but not implemented.
 */
@Injectable()
export class HookRegistry {
  private readonly logger = new Logger(HookRegistry.name);
  private readonly handlers = new Map<string, Set<HookHandler<unknown>>>();

  register<P>(name: string, handler: HookHandler<P>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as HookHandler<unknown>);
    return () => {
      set?.delete(handler as HookHandler<unknown>);
    };
  }

  async dispatch<P>(name: string, payload: P, ctx: HookContext): Promise<void> {
    const handlers = this.handlers.get(name);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      try {
        await handler(payload, ctx);
      } catch (err) {
        this.logger.error(
          `hook "${name}" handler failed (tenant=${ctx.tenantId} req=${ctx.requestId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /** Test-only: drop all handlers. */
  clear(): void {
    this.handlers.clear();
  }
}
