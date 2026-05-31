# shared/security

Helmet + per-tenant rate limit + audit log. Documented at the gateway-trust boundary (see **[ADR-0007](../../../docs/adr/0007-tenant-id-as-trust-gateway-responsibility.md)**) and the audit-log discipline that records every mutation for forensics.

## Public surface

- `helmetMiddleware()` — Express middleware with the policy from `helmet.ts` (CSP off in dev; everything else default)
- `PlatformThrottlerModule` — `@nestjs/throttler` wrapper; per-tenant tracker; named `default` (200 req/min) + `storefront` (60 req/min) buckets
- `AuditLogRepository.insert(entry)` — writes to `audit.audit_log` (RLS-scoped)
- `AuditLogInterceptor` — globally-registered Nest interceptor that auto-records 2xx mutations under `/admin/*` and `/storefront/checkout`
- `redactBody(input)` — defensive redactor: drops secret-like keys, truncates long strings, recursion-limited
- `SecurityModule` — `@Global`; applies the audit migrations on boot

## Migrations

- `0001_init.sql` — `audit.audit_log` table
- `0002_rls.sql` — FORCE RLS + tenant_isolation policy

## What's deliberately not here

- JWT auth, login endpoints, RBAC — see ADR-0007
- WAF / DDoS-mitigation — gateway concerns
- Secrets management — env-var driven today; would integrate with a real KMS in production

## Gotchas

- GraphQL execution contexts skip the throttler guard and the audit interceptor — Apollo's response object doesn't expose Express's `res.header()` that the throttler writes rate-limit headers to, and the audit interceptor wouldn't have a meaningful `req` to record. The api's GraphQL surface is read-only search, which is the right place to apply rate-limit at the gateway layer anyway.
