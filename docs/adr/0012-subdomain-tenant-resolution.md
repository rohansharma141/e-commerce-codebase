# ADR-0012: Storefront resolves tenant from subdomain

**Status:** Accepted
**Date:** 2026-06-01

## Context

The api requires `x-tenant-id` on every tenant-scoped request. Some component on the storefront has to decide which tenant the browser is talking to. Options:

1. **Subdomain** — `t-fashion.example.com` / `t-fashion.localhost:3001`.
2. **Path prefix** — `example.com/t/t-fashion/...`.
3. **Query param** — `example.com/?tenant=t-fashion`.
4. **Cookie** — set after a tenant-selector page.
5. **Per-tenant top-level domain** — `fashion-store.com`, `electronics-store.com`. One Next.js app per tenant. (Not really a "resolution" — this is "no resolution.")

The choice has real consequences for SEO (the tenant id ends up in URLs and search indexes), for theming (the request needs to know the tenant before the first byte renders), for analytics, for cookie scoping, and for production DNS/TLS setup.

## Decision

Subdomain.

In production: `t-fashion.commerce.example.com`. Each tenant has a CNAME (or apex if custom-domain), the storefront reads the Host header at the edge, the tenant id is everything before the platform's base domain.

In dev: `t-fashion.localhost:3001`. Modern browsers (Chrome, Firefox, Safari since ~2024) resolve `*.localhost` to `127.0.0.1` natively. Zero `/etc/hosts` edits required. Same code path as production.

Implementation:

- `apps/storefront/src/middleware.ts` matches every request, parses the Host header against `/^([a-zA-Z0-9._-]+)\.(localhost|.+)(?::\d+)?$/`, validates against a reserved-subdomain set (`www`, `api`, `admin`), and writes the tenant id into the request headers as `x-tenant-id`.
- Server Components read it via `headers().get('x-tenant-id')`. The storefront's urql client and REST wrapper both pull from the same place.
- Bare-localhost requests (no subdomain) redirect to the default dev tenant. Bare-production requests respond 400. Reserved subdomains (`www`, `api`, etc.) get the 400 path.

## Consequences

- **Clean URLs and SEO.** Tenant t-fashion's category page is `t-fashion.example.com/c/shirts`, not `example.com/t/t-fashion/c/shirts`. Search engines index each tenant as a distinct site, which is what the operator wants.
- **Theming reads from middleware.** The tenant is known before the first render, so the layout can load tenant theme variables at request time without an extra round-trip after the page paints. Storefront step 7f (per-tenant themes) builds on this.
- **Cookies scope naturally to tenant.** A cart cookie set under `t-fashion.example.com` is invisible to `t-electronics.example.com`. We belt-and-braces this with tenant-suffixed cookie names so subdomain misconfiguration doesn't surface another tenant's cart, but the browser-level isolation is the primary guarantee.
- **DNS and TLS need wildcard.** Production wants a wildcard cert (`*.commerce.example.com`) and a wildcard DNS record pointing at the storefront edge. Let's Encrypt supports this via DNS-01. Local dev avoids the issue entirely.
- **No `/etc/hosts` step in onboarding.** First-time developers run `pnpm nx serve storefront` and open `t-fashion.localhost:3001`. Nothing else.
- **CORS isn't an issue.** Subdomains share suffix but are different origins per the browser; server actions enforce same-origin, so subdomain-A can't drive subdomain-B's actions even if it tried.

## Trade-offs

- Tenant id appears in the public URL. That's intentional — it's a tenant subdomain like any SaaS — but it means tenant ids can't be sensitive. We already use slugs (`t-fashion`, `t-electronics`); never expose uuids.
- Custom-domain tenants need a domain-to-tenant map. Today the regex extracts everything before `localhost` or the base domain. For custom domains we'd lookup the host in a tenant directory. That's documented as a follow-up; the middleware's resolution logic stays the same shape.
- Reserved-subdomain list (`www`, `api`, `admin`) is maintained in middleware. Adding a new reserved subdomain is a code change. Acceptable for the demo; production would put this in config.

## Alternatives considered

**Path prefix `/t/<tenant>/...`.** Rejected — SEO consequence (search engines see one site with many sections, not many sites), uglier URLs, and theming would need a layout segment that conditionally varies on path. Subdomain solves the theming-at-request-time problem more cleanly.

**Query param `?tenant=...`.** Rejected — even worse for SEO, easy to spoof or forget, terrible URLs.

**Cookie set by a tenant-selector page.** Rejected — first visit has no cookie, no way to render anything. Forces a manual selector before any catalog page. Doesn't fit a multi-tenant SaaS where customers arrive directly at their tenant's URL.

**Per-tenant top-level domains.** Excellent for SEO and brand isolation but requires per-tenant deploys (one Next.js process per tenant) or aggressive runtime hostname routing. For platform-style multi-tenancy where all tenants share one storefront codebase, this is over-engineered.

## Links

- [apps/storefront/src/middleware.ts](../../apps/storefront/src/middleware.ts) — Host parsing and `x-tenant-id` injection
- [apps/storefront/src/lib/tenant.ts](../../apps/storefront/src/lib/tenant.ts) — `getTenantId()` for Server Components
- [packages/shared/tenant-context/src/tenant.middleware.ts](../../packages/shared/tenant-context/src/tenant.middleware.ts) — the api's tenant-id validation (same regex, fail-closed)
- [ADR-0007](0007-tenant-id-as-trust-gateway-responsibility.md) — why the tenant header IS the trust on the api side, and what the production gateway must do before that becomes safe
