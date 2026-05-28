/**
 * Minimal dedupe helper for event consumers. The bus is allowed to redeliver, so
 * consumers must be idempotent. Backed by an in-memory set today; swap for a
 * persistent store (e.g. Postgres processed_events table) when extracting a module.
 */
export class IdempotencyTracker {
  private readonly seen = new Set<string>();

  hasProcessed(eventId: string): boolean {
    return this.seen.has(eventId);
  }

  markProcessed(eventId: string): void {
    this.seen.add(eventId);
  }

  async runOnce(eventId: string, work: () => Promise<void>): Promise<boolean> {
    if (this.hasProcessed(eventId)) return false;
    await work();
    this.markProcessed(eventId);
    return true;
  }

  reset(): void {
    this.seen.clear();
  }
}
