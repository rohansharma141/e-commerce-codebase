# shared/observability

`/ready` endpoint + the OpenTelemetry-ready hooks. See **[ADR-0008](../../../docs/adr/0008-opentelemetry-designed-not-shipped.md)** for the trace topology we'd ship if scale demanded it.

## Public surface

- `ReadinessController` — registers `GET /ready`
- `ReadinessService.check()` → `{ ok, deps: { postgres, redis, opensearch } }`
- `ObservabilityModule` — `@Global`

## Behaviour

Each backing service is probed concurrently with a 1s budget. If any is `down`, `/ready` returns HTTP 503. `/health` remains pure liveness (process is up; no dep probing).

Probes:

- Postgres: `sql\`SELECT 1\`` via the singleton pool client
- Redis: `redis.ping()`
- OpenSearch: `cluster.health({ wait_for_status: 'yellow', timeout: '1s' })`

## Used by

- Kubernetes / Docker Compose readiness probes
- `apps/api` exposes both `/health` and `/ready` outside the tenant middleware chain
