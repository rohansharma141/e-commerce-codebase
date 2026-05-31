# shared/hooks

Typed in-process registry for named extension points. The platform's customisation API.

See **[ADR-0009](../../../docs/adr/0009-hooks-as-typed-in-process-registry.md)** for the design and the path to webhooks/plug-ins.

## Public surface

- `HookRegistry.register<P>(name, handler)` → unregister
- `HookRegistry.dispatch<P>(name, payload, ctx)` — sequential, exception-isolated
- `HOOK_NAMES.{OrderBeforeCreate, ProductAfterCreate}` — the enum of named extension points
- `HOOK_REGISTRY` token
- `HooksModule` — `@Global`

## Used by

- `apps/api/src/demo-hooks.module.ts` registers observer handlers for both points
- `packages/modules/orders/src/checkout.service.ts` dispatches `OrderBeforeCreate` after totals are computed
- `packages/modules/catalog/src/products/products.service.ts` dispatches `ProductAfterCreate` after a product create commits

## Tests

- `hook-registry.spec.ts` — sequential delivery, exception isolation, unregister, no-handlers no-op
