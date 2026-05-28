import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent, EventHandler, Unsubscribe } from './types';

/**
 * In-process event bus. Designed to behave as if every dispatch crossed a network:
 * payloads are cloned before delivery, handlers run async, handler failures are
 * isolated from the publisher. When a module is later extracted, the bus is
 * swappable for a real broker without consumers needing to change shape.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers = new Map<string, Set<EventHandler>>();

  publish<E extends DomainEvent>(event: E): Promise<void> {
    const subscribers = this.handlers.get(event.name);
    if (!subscribers || subscribers.size === 0) {
      return Promise.resolve();
    }

    const snapshot = Array.from(subscribers);
    for (const handler of snapshot) {
      const cloned = structuredClone(event);
      queueMicrotask(() => {
        Promise.resolve()
          .then(() => handler(cloned))
          .catch((err: unknown) => {
            this.logger.error(
              `Handler for "${event.name}" failed (eventId=${event.eventId}): ${
                err instanceof Error ? err.message : String(err)
              }`,
              err instanceof Error ? err.stack : undefined,
            );
          });
      });
    }
    return Promise.resolve();
  }

  subscribe<E extends DomainEvent>(name: E['name'], handler: EventHandler<E>): Unsubscribe {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as EventHandler);
    return () => {
      set?.delete(handler as EventHandler);
    };
  }

  clear(): void {
    this.handlers.clear();
  }
}
