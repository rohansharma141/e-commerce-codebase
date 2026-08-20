# ADR 0013 — ICM REST conformance and the `apps/icm-compat` facade

**Status:** Accepted (designed, not built)
**Date:** 2026-08-20
**Supersedes:** none
**Related:** ADR 0010 (storefront sells separately from the API), §6 of `PROJECT-BRIEF.md` (deliberately not built)

---

## Context

Intershop publishes its Angular storefront — the Intershop PWA — on GitHub under the MIT licence.
It is a production-grade commerce frontend, built by a vendor with three decades in the market,
that talks to a backend exclusively over a documented REST contract.

This platform claims, as rule 6, that **every capability must remain reachable through the public
API alone**, and packages the API and storefront as separately sellable deliverables. That claim is
currently supported by one consumer: our own Next.js storefront, written by the same author against
the same API, with an ESLint boundary rule as the enforcement mechanism.

A lint rule proves nobody *imported* across the boundary. It does not prove the public surface is
*sufficient* — that a consumer with no knowledge of our internals could build a complete storefront
against it. Those are different claims, and only the second one matters to a buyer evaluating the
API as a standalone product.

The Intershop PWA offers an unusually strong test of the second claim: an independent, adversarially
complete consumer we did not write and cannot influence.

## Decision

**1. Adopt ICM REST conformance as an architectural validation target, not a product requirement.**

The goal is to demonstrate that our public API surface is expressive enough to reconstruct a foreign
REST contract on top of it. The goal is *not* ICM compatibility as a feature, and no customer-facing
claim of Intershop interoperability follows from this work.

**2. When built, the translation layer lands at `apps/icm-compat/`.**

A third Nx project and third deployable alongside `api` and `storefront`, with its own Dockerfile.

It is bound by the same rules as the storefront:

- imports from `packages/api-client` only — never a domain module, never a shared backend lib
- talks to the API exclusively over the public GraphQL/REST surface
- no in-process calls, no shared memory, no direct database access

This is deliberate. A facade that reached into internals would invert the demonstration: the point
is that a foreign contract can be served *from the public surface alone*. If the facade ever needs
something the public API does not expose, **the correct fix is to extend the API**, exactly as it
would be for the storefront.

**3. The facade is a REST → GraphQL protocol translation, not a proxy.**

Our storefront read edge is GraphQL; REST is the admin/system surface. The PWA speaks REST
throughout. The facade therefore maps ICM REST resources onto GraphQL operations, reshapes responses
to ICM payload conventions, and supplies `x-tenant-id` on every downstream call, since the PWA has
no concept of our tenancy model.

Preferred tenancy approach: **one facade deployment per tenant with the header supplied as a
deployment parameter.** This keeps the facade stateless and dumb, and mirrors how Intershop's own
Helm charts treat backend location as a required deployment input rather than a build-time constant.
Facade-side hostname resolution mirroring the storefront middleware is the alternative and is
rejected as unnecessary duplication.

**4. Scope stops at faceted catalog browse.**

The PWA's cold-boot sequence is: server configuration → catalog read → search and suggestions →
basket → identity → checkout. Conformance through search is achievable against the API as it stands.
Identity is not: this platform has no customer authentication, which is a documented non-goal.

**Crossing into customer authentication to extend conformance requires its own ADR.** It is not a
continuation of this decision.

**5. Not built now.**

Recorded so the placement decision is not made under time pressure later. Construction is gated on
the platform's outstanding gap list — seed coverage of `catalog.products`, the storefront
Dockerfile, documentation drift, storefront contract tests, and the production CSP nonce — all of
which outrank it.

## Consequences

**Positive**

- Rule 6 becomes falsifiable rather than asserted. A second, independent consumer either boots or
  does not.
- The exercise is expected to surface at least one genuine gap on its own merits: a
  **server-configuration / capability-advertisement endpoint**. Our storefront can hardcode locales,
  currencies and feature flags; a foreign consumer cannot. Such an endpoint is good API design
  independent of this work and is tracked separately.
- Reconstructing a foreign REST contract from a GraphQL edge is a stronger expressiveness claim than
  a REST-over-REST shim would have been.
- The facade is a textbook anti-corruption layer and is demonstrable as such.

**Negative**

- A third deployable is a third thing to build, document, containerise and keep working.
- Conformance is binary. An API that is merely ICM-shaped returns 404, so partial work yields
  nothing demonstrable. Effort must be sized to reach a booting storefront or not spent.
- There is a standing temptation to let ICM's resource shapes influence our native API. They carry
  twenty years of history — `serverGroup` in a public URL path is server-topology leakage and must
  not be imitated. The facade exists precisely so that translation happens in one isolated place
  instead of leaking into the API.

**Neutral**

- No Intershop source enters this repository. Their PWA is studied in a separate workspace and is
  never vendored here. Findings will land as markdown in `docs/research/intershop/`, created when
  the first memo exists rather than stood up empty ahead of one.
- The MIT licence permits copying their code; we decline on portfolio grounds, since the platform
  being built from scratch is the evidence it exists to provide.

## Alternatives considered

**Do nothing; rely on the ESLint boundary rule.** Rejected: proves absence of imports, not
sufficiency of the public surface.

**Write our own second client to test the API.** Rejected: written by the same author with knowledge
of the internals, so it tests nothing the first storefront does not.

**Reshape the native API toward ICM conventions to avoid needing a facade.** Rejected outright.
Imports another vendor's historical baggage into our public contract to serve a validation exercise.

**Vendor the PWA into this monorepo.** Rejected: Nx would attempt to own an Angular application
against our pinned TypeScript, vendored source fails our lint configuration, and a reviewer cloning
the repository would find a large third-party codebase adjacent to a claim of building from scratch.
