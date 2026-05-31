# shared/event-bus

In-process pub/sub. Designed to behave as if every dispatch crossed a network — payloads are `structuredClone`'d before delivery, handlers run async on `queueMicrotask`, handler failures are isolated from publishers. When a module is extracted later, swapping for a real broker is a one-file change.

## Public surface

- `EventBus` — `publish`, `subscribe`, `clear`
- `EventBusModule` — `@Global` Nest module
- `DomainEvent<TName, TPayload>` — `{ name, payload, eventId, occurredAt, tenantId, correlationId? }`
- `IdempotencyTracker` — `runOnce(eventId, work)`; consumers use this because the bus may redeliver

## Used by

- Catalog publishes `catalog.product.{created,updated,deleted}` and `catalog.attribute-definition.created`
- Search indexer (`product-indexer.service.ts`) subscribes to all of the above
- Orders publishes `orders.created`
- Future: analytics/email modules subscribe

## Why structuredClone on dispatch?

A handler that mutates its received payload must not affect a sibling handler that runs after it. Pretending the bus is the network at publish time enforces the discipline cheaply: the moment the bus is replaced with Kafka/NATS/SQS, the same handler code keeps working.

## Tests

- `event-bus.spec.ts` — publish → subscribe, structuredClone isolation, handler-error isolation, unsubscribe, no-subscribers, idempotency dedupe
