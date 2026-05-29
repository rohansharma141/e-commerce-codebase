export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/**
 * Domain event. Payloads SHOULD be JSON-serializable (CLAUDE.md: "write events
 * as if they already cross a network — they will"), but the TS constraint is
 * intentionally loose: readonly tuples and module-specific DTO types don't
 * always satisfy a strict JsonValue without ceremony, and the discipline is
 * better enforced by the bus's structuredClone at publish time than by the
 * type system. Producers pass typed payloads; consumers narrow at the edge.
 */
export interface DomainEvent<TName extends string = string, TPayload = unknown> {
  readonly name: TName;
  readonly payload: TPayload;
  readonly occurredAt: string;
  readonly eventId: string;
  readonly tenantId: string;
  readonly correlationId?: string;
}

export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>;

export type Unsubscribe = () => void;
