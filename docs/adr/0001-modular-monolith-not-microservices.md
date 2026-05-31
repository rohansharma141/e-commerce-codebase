# ADR-0001: Modular monolith, not microservices

**Status:** Accepted
**Date:** 2026-05-28

## Context

This platform is a multi-tenant headless commerce system in the same architectural lane as commercetools and Medusa. The audience is technical decision-makers (CTOs, architects) evaluating the codebase as a portfolio piece. There is a natural temptation to ship as microservices because "that's how enterprise platforms look."

We have to make this choice before the catalog module exists, which means we'd be designing the inter-service contracts before the actual domain boundaries are validated by working code.

## Decision

Build as a modular monolith deployed as a single `apps/api` process. Enforce three disciplines so that future extraction is cheap when it's actually justified:

1. **No cross-module SQL joins, ever.** Each module owns its own Postgres schema (`catalog`, `pricing`, `orders`, `audit`).
2. **Events are network-strict.** Plain serializable objects, idempotent consumers, `structuredClone` on every publish so a handler can't mutate state another handler will see.
3. **No cross-module `src/` imports.** ESLint `@nx/enforce-module-boundaries` fails the build on violation.

Module-to-module communication uses contract-defined service interfaces and tokens (e.g. `TOTALS_SERVICE`, `CART_SERVICE`) — concrete implementations live in `<module>/src` and are registered against tokens declared in `<module>/contracts`. Consumer modules `@Inject` the token; the actual class is never imported across the boundary.

## Consequences

- The single deployable is much easier to set up, reason about, debug, and demo. A reviewer can run the whole stack with `docker compose up`.
- Domain boundaries are still learnable — when a real catalog migration arrives that touches both catalog and pricing, the modular constraints force the answer to be "events, not joins."
- A wrong boundary inside the monolith is an afternoon's refactor. A wrong boundary between deployed services is a multi-week migration involving a new network protocol, deployment topology, and operational story.
- When the platform genuinely outgrows one process (it won't, at portfolio scale), the extraction is mostly mechanical because the three disciplines above already pretend the network exists. See [ARCHITECTURE.md § extraction map](../ARCHITECTURE.md#extraction-map--which-modules-would-split-first).

## Alternatives considered

**Real microservices (Kafka or similar between modules).** Burns the time budget on distributed-systems plumbing (service mesh, saga orchestration, eventual-consistency debugging) that demonstrates *ops* skill, not the *architecture* skill we're showcasing. Worse, with no real production load to inform partition boundaries, we'd be designing inter-service contracts blind. The senior signal here is *deliberate* non-distribution — pointing at the clean extraction boundaries and explaining when/which to split first. Building distributed for a demo can read as the *junior* move (complexity for its own sake).

**Modules as `npm` packages with no enforcement.** No build-time discipline means a single PR breaks the architecture. The eslint boundary rule is the load-bearing test that this is a *modular* monolith, not just a monolith.

## Links

- [packages/modules/](../../packages/modules/) — each module's schema + contracts + src
- [.eslintrc.cjs](../../.eslintrc.cjs) — `@nx/enforce-module-boundaries` rule
- [DECISIONS.md § D-01](../DECISIONS.md) — the original framing
- [ADR-0009](0009-hooks-as-typed-in-process-registry.md) — the in-process extension-point design that complements this choice
