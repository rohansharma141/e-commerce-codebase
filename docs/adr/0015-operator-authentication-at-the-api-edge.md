# ADR-0015: Operator authentication at the api edge

**Status:** Accepted (designed, not built)
**Date:** 2026-08-28

## Context

[ADR-0007](0007-tenant-id-as-trust-gateway-responsibility.md) specified an authentication gateway with four behaviours — authenticate, resolve the tenant from the claim, inject `x-tenant-id`, strip any inbound one — and then deliberately did not build it. That was the right call in May: the api's only consumers were a developer with `curl` and a storefront on the same private network, and the alternatives section says so plainly — *"None of that demonstrates the platform-architecture skill the portfolio is showcasing."*

The channels slice ([ADR-0014](0014-channel-as-sales-channel.md)) changes the premise, and this ADR exists to argue with ADR-0007's conclusion rather than route around it.

**What changed is not the value of auth. It is the arrival of a new artifact.** Phase E adds `apps/back-office/`: a console where an operator edits a channel's currency and tax rate. Three things follow that were not true before.

1. **An admin console without a login reads as a toy**, and it is the artifact a non-technical stakeholder will actually be shown. The portfolio cost of shipping it credential-free is larger than the portfolio cost of the auth code.
2. **The deployment pattern would expose it.** `deploy/k8s/` publishes the storefront through a wildcard Ingress (`*.example.com`) and deliberately gives the api no Ingress at all — it is cluster-internal, reachable only by the storefront's NetworkPolicy. A back office is a *user-facing app*, so it follows the storefront's pattern, not the api's. That is a third deployable on the public Ingress whose entire purpose is editing tenant configuration. Nothing is exposed today; the point is that the manifests already answer the question of how it would be, and the answer is "on the internet".
3. **Configuration changes need an actor.** ADR-0007 reserved a nullable `actor` column in the audit log for exactly this. A currency edit that cannot be attributed is not auditable, and "who changed the tax rate" is the first question anyone asks of a back office.

Gate G-1 closed on 2026-08-28: auth is a **prerequisite slice at minimum scope**, sequenced before C-20. An undated gate becomes permanent, and "we'll add auth later" ages badly next to a deployed admin panel.

## Decision

**Build the gateway ADR-0007 specified — its four behaviours, minimally — as an edge concern inside the api rather than as a separate deployable.**

### 1. It lives in `packages/shared/auth`, not in a new service

A standalone gateway process is the literal reading of ADR-0007, and it is the wrong build for this platform. Splitting it out buys a network hop, a second deploy pipeline and a shared-secret distribution problem, and demonstrates *ops* skill rather than the architecture skill in question — the same judgement as [D-08](../DECISIONS.md) on microservices. The extraction stays cheap because the seam is a middleware boundary: moving verification to an edge proxy later changes no module, only where the token is checked.

`AuthMiddleware` replaces `TenantMiddleware` in the chain and binds the same `AsyncLocalStorage` context, gaining an `actor`. `currentTenant().tenantId` keeps working everywhere, which is what ADR-0007 predicted.

### 2. Fail closed by default; dev opts out explicitly

Authentication is **required unless `AUTH_DISABLED=1`**, which the dev compose profile and the seed set.

The tempting inverse — default off, enable in production — is how a control ends up unset in the one environment that mattered. A security default that has to be remembered is not a default. The cost is that every developer meets the flag on day one, which is the correct place to meet it.

When disabled the middleware binds a synthetic `actor` of `dev`, so the audit log never carries a null actor and nothing downstream branches on whether auth is on.

### 3. Bearer JWT, verified two ways, with the IdP left as configuration

- **JWKS URL configured** → verify RS256 against the published key set. This is the production path and the one a real IdP (Entra, Auth0, Keycloak, Cognito) plugs into with no code change.
- **No JWKS** → verify HS256 against a configured secret, for local and CI.

The api **verifies** tokens; it does not federate, refresh, or manage sessions. That boundary is what keeps this a slice rather than a project.

### 4. A minimal local operator store, because a console needs something to log in with

"IdP left as configuration" is not sufficient on its own: the demo has to be runnable from a cold clone, and standing up Keycloak in compose to log into a portfolio console is ops theatre.

So: an `operator` table (email, argon2id hash, `tenant_id`, `role`), one seeded operator per tenant, and `POST /auth/token` issuing a short-lived access token. It is deliberately the smallest credible thing, and it is the piece explicitly designed to be **deleted** when a real IdP is configured — the verification path above does not depend on it.

### 5. One role, tenant-scoped

`operator`. No RBAC matrix, no per-resource permissions, no delegation. The claim carries `tenant_id` and `role`, and the api authorises `/admin/*` on presence of the role.

A permission model is a genuine product surface and inventing one to guard four screens would be scope inflation of exactly the kind this backlog is arranged to prevent. Recorded as a stated simplification, not an oversight.

### 6. Scope: the admin surface and the back office only

| Surface | Posture |
|---|---|
| `/admin/*`, `/system/*` | Requires a valid operator token |
| Back office | Requires a login |
| Storefront reads (`/graphql`, `/api/{tenant}/graphql`) | Unchanged — public catalogue |
| Storefront writes (cart, checkout) | Unchanged — anonymous carts are a feature |
| **Customer** accounts | **Out of scope**, and needs its own ADR |

Customer authentication is a different problem — registration, password reset, order history, GDPR erasure — and merging it into an operator-auth slice is how both arrive half-built.

### 7. The tenant comes from the claim, never from the header

With auth enabled, an inbound `x-tenant-id` is **discarded**, not merged and not preferred. This is ADR-0007's behaviour 4, and the same rule the URL/header scope assertion already follows ([ADR-0014 §2](0014-channel-as-sales-channel.md)): silently picking a winner between two sources of identity turns a mismatch into an exploit rather than an error.

## Consequences

- ADR-0007 is **amended, not superseded.** Its posture — the api trusts a resolved tenant bound at the edge — is unchanged; this ADR implements the edge it described and moves the trust boundary from "a header the deployer must protect" to "a signature the api verifies". Its caveats 2–4 (private network, split Postgres roles, persistent idempotency dedupe) all still stand.
- The audit log's reserved `actor` column is finally populated. That column existing since May is why this costs a migration on nobody's table.
- `curl -H 'x-tenant-id: t-fashion'` keeps working in dev, under an explicit flag. Every README and RUNBOOK command needs that flag audited, and the cold-clone tour re-run — the flow the reader follows must not require an undocumented token.
- CI gains a job that asserts `/admin/*` returns **401 without a token when auth is enabled**. Asserting the enabled path is the check; asserting the disabled path proves nothing, and a suite that only ever runs with `AUTH_DISABLED=1` would pass against a middleware that authorises everything.
- The storefront is untouched, which keeps [ADR-0010](0010-storefront-sellable-separately.md) intact: the api still ships alone, and the back office is a third deployable that happens to need a login.

## Alternatives considered

**Keep ADR-0007's posture and ship the back office behind a network boundary.** Cheapest, and genuinely defensible: the api already has no Ingress, and a back office could be given the same treatment plus port-forward access. Rejected on two grounds. The console is the artifact shown to non-technical stakeholders, and one reachable only by `kubectl port-forward` is not a demonstration of a back office. And a network boundary is a deployment property, not a repository property — it holds until the first person writes the Ingress that makes the console usable, at which point nothing in the code objects.

**A gate with a written expiry instead of a prerequisite.** Considered seriously and rejected at G-1. An undated gate becomes permanent; a dated one becomes a broken promise in a repo where every other claim is checked. Nothing else in this backlog is sequenced on a date.

**Full OIDC with a Keycloak container in compose.** The most realistic, and it makes the cold-clone tour heavier for every reader in exchange for demonstrating IdP configuration rather than platform architecture. The JWKS path above means a real IdP remains a config change, which is the demonstration that matters.

**Session cookies rather than bearer tokens.** Simpler for a browser console, and would give CSRF a first-class role. Rejected because the api is consumed by more than a browser and a bearer token is uniform across the back office, `curl`, and any future integration; [ADR-0011](0011-server-actions-not-cors.md) already keeps browser credentials off the api for the storefront.

**Authorise per resource rather than per role.** The correct long-term answer and disproportionate now — see §5.

## What this deliberately does not build

Refresh-token rotation · MFA · password reset · account lockout · SSO/SCIM provisioning · per-resource permissions · customer accounts · API keys for machine callers · token revocation lists.

Each is a real requirement for a production identity system and none is load-bearing for demonstrating that the platform has an authenticated admin surface. Listing them is the point: a reviewer should be able to see the boundary was chosen rather than missed.

## Links

- [ADR-0007](0007-tenant-id-as-trust-gateway-responsibility.md) — the gateway contract this implements, and the alternatives section this ADR argues with
- [ADR-0014 §2](0014-channel-as-sales-channel.md) — the URL/header assertion that follows the same never-reconcile-two-identities rule
- [ADR-0003](0003-rls-not-where-only.md) — the database backstop that made the header-trust window survivable
- [docs/BACKLOG-channels.md](../BACKLOG-channels.md) — G-1, and the auth slice sequenced before C-20
- [packages/shared/tenant-context/src/tenant.middleware.ts](../../packages/shared/tenant-context/src/tenant.middleware.ts) — what `AuthMiddleware` replaces
- [packages/shared/security/src/audit-log.repository.ts](../../packages/shared/security/src/audit-log.repository.ts) — the `actor` column reserved in May
