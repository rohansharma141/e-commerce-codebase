# ADR-0008: OpenTelemetry designed, not shipped

**Status:** Accepted
**Date:** 2026-05-31

## Context

Step 6's observability brief was to make the platform reviewable. The two distinct concerns:

1. **Polish what we have.** Structured logging is already in place (pino). What's missing: a stable `requestId` that propagates across log lines for one HTTP request; a `/ready` endpoint distinct from `/health` (liveness) that probes each backing service.
2. **Ship distributed tracing and metrics.** OpenTelemetry, exporters, an aggregator (Jaeger/Tempo for traces, Prometheus for metrics, OTLP collector to glue them together).

Concern (1) takes ~half a day and is genuinely useful at portfolio scale — a reviewer can grep one request's id through the logs and follow checkout end-to-end. Concern (2) is 2–3 days and produces almost no demo value without real traffic to inspect; in a single-process modular monolith on a laptop, the spans are trivial and the dashboards are empty.

## Decision

Ship (1). Document (2) here for when it lands.

### What we shipped

- `req.id` in every log line, set by pino's `genReqId` to the inbound `x-request-id` header (or a uuid). `TenantMiddleware` echoes the same id into ALS via `currentTenant().requestId` and back to the client via the `x-request-id` response header. One request, one id, everywhere.
- `/ready` endpoint that probes Postgres (`SELECT 1`), Redis (`PING`), and OpenSearch (`/_cluster/health`) concurrently with a 1s budget each. Returns `200 { ok: true, deps: {...} }` or `503 { ok: false, deps: {...} }`. See [packages/shared/observability/src/readiness.service.ts](../../packages/shared/observability/src/readiness.service.ts).
- `/health` remains pure liveness (Nest process is alive). Docker compose's `healthcheck` directives hit `/health`. Kubernetes-style topologies would hit `/health` for `livenessProbe` and `/ready` for `readinessProbe`.

### What we'd ship next (the OTel design)

If/when this platform serves real traffic and an SRE team owns it:

**Trace topology:**

```
  HTTP root span (Express middleware)
    │
    ├── tenant-binding span (sql.reserve + SET app.tenant_id)
    ├── express route span (e.g. POST /storefront/checkout)
    │    ├── pricing.totals.compute (DB reads)
    │    │    ├── prices.findByProductIds (pg span)
    │    │    └── promotions.listActiveCandidates (pg span)
    │    ├── cart.get (redis span)
    │    ├── orders.checkout (BEGIN/INSERT*/COMMIT)
    │    │    ├── promotions.tryIncrementUsesCount (pg span)
    │    │    └── orders.* insert spans
    │    ├── hooks.dispatch(order.before-create) (custom span per handler)
    │    └── eventBus.publish(orders.created) (custom span per subscriber)
```

**Auto-instrumentation libraries:**

- `@opentelemetry/instrumentation-http` — root HTTP span
- `@opentelemetry/instrumentation-nestjs-core` — route + interceptor spans
- `@opentelemetry/instrumentation-pg` — postgres-js spans (or a manual wrapper since postgres-js has no auto-instrumentation today; the work is ~50 lines around the reserved-connection lifecycle)
- `@opentelemetry/instrumentation-ioredis` — redis spans
- Manual instrumentation for the EventBus and HookRegistry — start a child span per handler so handler-level latency is attributable

**Exporter:** OTLP gRPC to `localhost:4317`, batched. Docker compose gets a Jaeger all-in-one alongside the existing services for local trace inspection.

**Metrics:** `@opentelemetry/sdk-metrics` for histograms (search latency, checkout duration), counters (orders.created.total, hooks.fired.total), gauges (pool connection count). Same OTLP exporter; aggregator pushes to Prometheus.

**Trace context propagation in events:** `traceparent` flows on every published event so a subscriber's span links back to the publisher's. Already accommodated by the event payload shape (`correlationId?`) — would be repurposed for `traceparent` if needed.

## Consequences

- Today: a request's logs are grep-able by `req.id`. That covers the failure-mode-investigation use case at demo scale.
- Today: `/ready` distinguishes "process up" from "deps healthy." Kubernetes/docker-compose can act on the difference.
- Tomorrow (when this matters): the OTel work is ~2–3 days and benefits from there being actual production traffic to inspect. Doing it now means decorating code paths whose latencies are all in the single-digit-millisecond range — the data is uninteresting.
- The instrumentation surface (where to start spans, what attributes to record) is already planned out here, so the work doesn't start from a blank page.

## Alternatives considered

**Ship OpenTelemetry now without an aggregator.** Would add the SDK deps and instrumentation, but with nowhere to send the data the spans go to the console at best. Code complexity without payoff.

**Roll our own latency log lines and skip OTel entirely.** We do this for search (the seed reports p50/p95/p99). That's plenty for portfolio scale. Real distributed tracing earns its keep when a request can fail in ten places across services; we have one process.

**Pick a SaaS APM (Datadog, New Relic).** Would let us punt on the aggregator question. Not free, doesn't run locally, adds vendor coupling we'd want to revisit.

## Links

- [packages/shared/observability/](../../packages/shared/observability/) — what's actually shipped
- [packages/shared/tenant-context/src/tenant.middleware.ts](../../packages/shared/tenant-context/src/tenant.middleware.ts) — `requestId` propagation
- [apps/api/src/app.module.ts](../../apps/api/src/app.module.ts) — pino `genReqId` wiring
