/**
 * Stable, string-typed extension-point names. Importers reference these
 * constants rather than raw strings so a hook firing in a different module
 * shows up in cross-references.
 *
 * Hooks vs events (shared/event-bus): events are fan-out notifications that
 * consumers SUBSCRIBE to, fire-and-forget, often cross module boundaries to
 * indexers/analytics/email. Hooks are EXTENSION POINTS — a fixed list the
 * platform publishes as a customisation API. Today the implementations sit on
 * top of the same in-process map, but the conceptual line is what the docs
 * (and a future webhook bridge) use to draw the boundary.
 */
export const HOOK_NAMES = {
  OrderBeforeCreate: 'order.before-create',
  ProductAfterCreate: 'product.after-create',
} as const;

export type HookName = (typeof HOOK_NAMES)[keyof typeof HOOK_NAMES];
