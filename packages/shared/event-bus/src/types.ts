export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface DomainEvent<TName extends string = string, TPayload extends JsonValue = JsonValue> {
  readonly name: TName;
  readonly payload: TPayload;
  readonly occurredAt: string;
  readonly eventId: string;
  readonly tenantId: string;
  readonly correlationId?: string;
}

export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>;

export type Unsubscribe = () => void;
