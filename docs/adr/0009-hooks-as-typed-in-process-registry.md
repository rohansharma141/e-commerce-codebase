# ADR-0009: Hooks as a typed in-process registry

**Status:** Accepted
**Date:** 2026-05-31

## Context

Step 6's customizability brief was to ship one concrete extension-point pattern. Real commerce platforms expose hundreds of these — pre/post hooks around cart actions, order lifecycle transitions, pricing-rule plug-ins, product-attribute validators, fulfillment policy decisions, custom shipping calculators. The implementation strategy varies enormously:

- commercetools: API extensions (HTTP webhooks called synchronously) + subscriptions (async events to message queues)
- Medusa: a plugin registry that loads code at startup
- Shopify: scripts (now Functions) — sandboxed code running in a wasm runtime
- Magento: PHP plug-ins + events with priority-ordered observers

The right answer depends on what we're optimising for: dynamism (tenant-managed code loaded at runtime), safety (sandboxing), simplicity (in-process code), or audit (centrally-managed config).

## Decision

For this platform's first extension-point implementation, ship the simplest viable version: a **typed in-process registry**, observers-only.

```ts
// packages/shared/hooks/src/hook-registry.ts
class HookRegistry {
  register<P>(name: string, handler: HookHandler<P>): Unregister;
  dispatch<P>(name: string, payload: P, ctx: HookContext): Promise<void>;
}
```

Hook names are an enum:

```ts
HOOK_NAMES = {
  OrderBeforeCreate: 'order.before-create',
  ProductAfterCreate: 'product.after-create',
}
```

Handlers receive `(payload, ctx)` where `ctx = { tenantId, requestId }`. They run sequentially. Exceptions are isolated — a throwing handler is logged but never breaks the parent flow.

Demo handlers register in `apps/api/src/demo-hooks.module.ts` so a reviewer can see firing in the api logs (search for `[demo-hook]`).

### Hooks vs events

Both ride the same in-process delivery mechanism today, but they are conceptually different:

- **Events** (`shared/event-bus`) are fan-out notifications. Many subscribers, network-strict shape, idempotent consumers, cross-module by design.
- **Hooks** are a *named, documented, finite* extension-point API. Tenants and platform consumers know which hooks exist; the set evolves deliberately.

## Consequences

- Customisation works today, can be inspected, and the firing is observable in api logs.
- Tenants can't bring their own code yet — handlers register in `apps/api` startup, not from a runtime config. That's the right next step but not this step.
- Mutating hooks (a handler that can transform the payload — e.g. apply a custom price adjustment) are out of scope. The dispatch signature would change to:
  ```ts
  dispatch<P>(name, payload, ctx): Promise<P>  // returns the (possibly-transformed) payload
  ```
  With a "first non-undefined return wins" or "fold over handlers" semantics. The design is straightforward; the bug surface is real (order of registration matters, transformation interactions between handlers, validation of transformed payloads). We chose to ship observer-only and earn the right to ship mutating later when there's a concrete use case driving the design.

## The path to runtime-managed plug-ins

Three evolutions, each justified by a real use case:

1. **Webhook-based extensions** — tenants register an HTTPS URL; the platform POSTs the payload synchronously and uses the response (for mutating hooks) or fires it async (for observers). Used by commercetools API extensions. Pros: tenant code runs in their own infra, no sandboxing complexity. Cons: latency, retry semantics, security (signing requests, verifying responses).
2. **Sandboxed scripts** — tenant uploads code; the platform runs it in a wasm runtime or v8 isolate. Used by Shopify Functions. Pros: fast, no network round-trip. Cons: huge engineering surface (sandboxing, resource limits, debugging stories for the tenant).
3. **Plugin packages** — npm packages loaded at startup with manifest-declared hook subscriptions. Used by Medusa. Pros: simplest tenant DX. Cons: requires platform redeploys when a tenant updates a plug-in; doesn't scale to many tenants.

The right answer probably involves all three for different use cases. Today: none of them, the in-process registry pattern carries the architectural intent.

## Alternatives considered

**Just use events.** Considered hard. Hooks ARE events under the hood. The reason for the separate identity is conceptual — events are a fan-out notification primitive; hooks are a published API surface. The named-extension-point API is the design contract that future webhooks/plug-ins implement, regardless of whether the implementation today is an in-process dispatch over the event bus.

**ts-decorator-style hooks (`@OnHook('order.before-create')`).** Decorator metadata is real, but the dispatch becomes implicit — harder to read, harder to test, harder to inspect. We prefer explicit `hooks.register` + `hooks.dispatch` calls that grep cleanly.

**Async hooks (`emit('order.before-create', payload)` returning immediately, handlers fire in background).** Wrong for mutating hooks (the parent flow needs the result). For observer-only, the difference between "dispatch awaits all handlers" and "fire and forget" matters less, but synchronous dispatch is easier to reason about — you know when handlers have run.

## Links

- [packages/shared/hooks/src/hook-registry.ts](../../packages/shared/hooks/src/hook-registry.ts) — the registry
- [packages/shared/hooks/src/hook-names.ts](../../packages/shared/hooks/src/hook-names.ts) — the named extension points
- [apps/api/src/demo-hooks.module.ts](../../apps/api/src/demo-hooks.module.ts) — demo handlers (where a real platform would load tenant plug-ins)
- [packages/modules/orders/src/checkout.service.ts](../../packages/modules/orders/src/checkout.service.ts) — the dispatch site for `order.before-create`
- [packages/modules/catalog/src/products/products.service.ts](../../packages/modules/catalog/src/products/products.service.ts) — the dispatch site for `product.after-create`
