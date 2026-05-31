# ADR-0002: Build from scratch, not on top of Medusa

**Status:** Accepted
**Date:** 2026-05-28

## Context

Medusa is the closest existing project to what we're building: Node/TypeScript, modular monolith, headless, Postgres-backed, open-source. Medusa 2.0 removed the cross-module DB coupling that earlier versions had, and there's a published Postgres-RLS multi-tenancy pattern that fits our needs. For a *commercial* venture, adopting Medusa would be the rational choice — it compresses years of work into months and our differentiator (native multi-tenancy) is buildable on top.

The platform's primary goal, however, is not commercial. It's a portfolio piece demonstrating the ability to **architect and build a full-scale enterprise commerce platform**. The audience is technical decision-makers evaluating platform-architecture capability specifically.

## Decision

Build from scratch. Don't adopt Medusa, commercetools-equivalent libraries, or any other existing commerce framework.

## Consequences

- The hard parts — catalog, cart, order, pricing, promotion engine, search integration — are *our* code, not someone else's. That's the actual demonstration.
- The build takes longer and the codebase is smaller in feature surface than Medusa's. We accept this in exchange for depth: a thin slice with a clean spine is the portfolio claim, not a feature ladder against Medusa.
- We don't inherit Medusa's bug fixes, plugin ecosystem, or community. None of these are part of what we're demonstrating.
- If the goal ever shifts to a commercial product, this decision should be revisited immediately. Medusa is a genuinely good starting point for a real business; the only reason we're not on it is the *demonstration* framing.

## Alternatives considered

**Build on Medusa.** Right for a commercial venture. Wrong here because the hard parts would be Medusa's work, not ours. A reviewer looking at "Medusa + multi-tenancy wedge" would correctly conclude that we've demonstrated *integration* skill, not platform-architecture skill.

**Fork Medusa and replace the parts we care about.** Worst of both worlds: we carry Medusa's complexity AND don't get to point at our own architectural choices. The "I rewrote the catalog module" comparison invites the question "why didn't you just build it" and we have no good answer.

**Use commercetools as inspiration but write code from scratch.** This is essentially what we're doing — the architecture-level decisions (custom attributes, MACH-style API surface, per-tenant config) are commercetools-influenced. The difference is we didn't take their code.

## Links

- [DECISIONS.md § D-09](../DECISIONS.md) — the longer reasoning, including the competitive analysis
- [CLAUDE.md](../../CLAUDE.md) — the operational framing that codifies this choice
