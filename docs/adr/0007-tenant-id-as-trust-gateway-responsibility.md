# ADR-0007: Tenant id as trust — gateway responsibility

**Status:** Accepted, with caveats — amended by [ADR-0015](0015-operator-authentication-at-the-api-edge.md)
**Date:** 2026-05-31

> **Amended 2026-08-28.** The posture below is unchanged: the api trusts a tenant resolved at the edge. What has changed is that the edge now exists. [ADR-0015](0015-operator-authentication-at-the-api-edge.md) implements the four gateway behaviours specified here, and argues explicitly with the *"Build a full JWT auth slice now"* alternative rejected below — the back office is a new artifact that inverts its cost/benefit. Caveats 2–4 still stand.

## Context

The api today trusts the `x-tenant-id` request header outright. The middleware validates shape (regex `/^[a-zA-Z0-9._-]{1,64}$/`) and rejects missing or malformed values, but it does not verify *that the caller is authorised to claim that tenant id*. A curl from anywhere with a valid-shaped header reaches the database as that tenant.

This is obviously not safe for a production deployment with untrusted clients on the open internet.

## Decision

In the platform's *deployed* topology, the api sits behind an authentication gateway (BFF, edge proxy, API gateway — pick your buzzword). The gateway:

1. Authenticates the caller (JWT, OIDC, session cookie, mTLS — depends on the deployment).
2. Resolves the caller's authorised tenant from the auth claim.
3. Injects `x-tenant-id` into the upstream request to the api.
4. Strips any inbound `x-tenant-id` the client tried to send.

The api treats the header as **already-verified trust** from the gateway. The shape validation is the api's contribution to defense in depth (catches header-injection at the api edge); the *authorisation* is upstream.

## Consequences

- For local development and the demo, `curl -H 'x-tenant-id: t-fashion' …` works directly. This is the right developer experience for a single-node modular monolith — auth shouldn't be in the way of architectural exploration.
- The api's tests (`/health`, `/ready`, the rate limiter, the audit log) all operate without an auth module. Removes a large surface that would otherwise need maintenance.
- The platform isn't independently deployable to the open internet. Any production deployment must add the gateway. This is documented; not a hidden surprise.
- The audit log captures `request_id` (correlates with the gateway's log) and reserves an `actor` column (nullable today, populated when auth lands).
- When auth lands, it lands as a *separate module* (`packages/shared/auth` or `packages/modules/auth`). The api's `TenantMiddleware` would be replaced by an `AuthMiddleware` that decodes the JWT, derives tenant + actor, and writes both into the same ALS. Almost no other module changes — `currentTenant().tenantId` continues to work because that's what's bound.

## Alternatives considered

**Build a full JWT auth slice now.** Would be 1–2 weeks of code: key management, login endpoint, refresh tokens, RBAC for admin-vs-storefront, the gateway code in front. None of that demonstrates the *platform-architecture* skill the portfolio is showcasing — it demonstrates auth implementation, which is a different conversation. We chose to leave room for a future "ADR-0010: JWT auth module" rather than ship a half-built version now.

**Validate the header against a tenant registry on every request.** Would let us reject "no such tenant" at the api edge. The registry doesn't exist yet (there's no `tenants` table — tenant ids are conceptual, attached to rows). Adding it for the header-validation use case alone is solving a problem we don't have until the auth module exists, at which point the validation belongs upstream of the api anyway.

**Read tenant from a JWT claim today, signed with a dev-only key.** Confuses the message — a reviewer would correctly ask "is that real auth or theatre?" and the answer is theatre. Better to be explicit that auth is documented-not-built.

## Caveats — what to do if you want to deploy this

Before exposing this api to traffic from untrusted clients:

1. Put an auth gateway in front. Stripping/injecting `x-tenant-id` is the gateway's contract with the api.
2. Run the api on a private network — never expose port 3000 directly.
3. Run two Postgres roles: `platform_owner` (table owner, runs migrations) and `platform_app` (the runtime, no DDL grants, no `BYPASSRLS`). Right now both responsibilities are bundled in one `platform` role for demo simplicity.
4. Replace the in-memory `IdempotencyTracker` (event-bus dedupe) with a persistent store. It's fine for a single-process demo; multi-process needs Redis-backed dedupe.

## Links

- [packages/shared/tenant-context/src/tenant.middleware.ts](../../packages/shared/tenant-context/src/tenant.middleware.ts) — the header-trust contract
- [packages/shared/security/src/audit-log.repository.ts](../../packages/shared/security/src/audit-log.repository.ts) — the audit log with reserved `actor` column
- [ADR-0003](0003-rls-not-where-only.md) — the database-level defense that makes this header-trust posture less terrifying than it sounds
