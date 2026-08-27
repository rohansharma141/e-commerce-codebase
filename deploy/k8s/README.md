# Kubernetes manifests

**These are written, validated, and not deployed.** That is the decision, not an
admission — see [ADR-0001](../../docs/adr/0001-modular-monolith-not-microservices.md)
and the cloud reasoning in [DECISIONS.md](../../docs/DECISIONS.md) (D-10, D-11).

Provisioning a cluster would demonstrate SRE skill and cost time that belongs to
the architecture. Docker Compose is the artifact that genuinely runs; this is
the artifact that shows what the platform looks like when it earns Kubernetes.
Reaching for a cluster before that point is the thing these manifests are meant
to show judgement about.

What they are not is unchecked. Every file is validated against the real
Kubernetes JSON schemas in strict mode on every push, so "not deployed" does not
quietly become "would not apply".

```bash
docker run --rm -v "$PWD/deploy/k8s:/work" -w /work \
  ghcr.io/yannh/kubeconform:latest -strict -summary -kubernetes-version 1.31.0 .
# Summary: 16 resources found in 16 files - Valid: 16, Invalid: 0
```

## Two bundles, because there are two products

```
deploy/k8s/
  00-namespace.yaml
  api/           ← a complete deploy on its own
  storefront/    ← added only for the bundled product
```

An API-only customer applies the namespace and `api/`. That is 8 resources and
it stands alone: nothing in `api/` requires a storefront object to exist. The
NetworkPolicy's storefront selectors simply match nothing, and
`STOREFRONT_REVALIDATE_URL` is removed from the ConfigMap — the webhook
dispatcher sees no URL and disables itself rather than failing.

This is the same rule the ESLint boundaries and the Compose file enforce,
expressed a third time. If it were only true in the build, it would not be true
in production.

## Decisions worth arguing with

**The data stores are not in the cluster.** No Postgres StatefulSet, no Redis
Deployment, no OpenSearch operator. Production Postgres wants managed backups,
point-in-time recovery, failover and someone else's pager; running it here to
make the manifests look complete would be the wrong lesson. They are referenced
as endpoints in a Secret. The Compose file runs them locally because a laptop is
not production.

**Migrations run at pod start, not as a Job.** The API applies its own
migrations on boot behind a Postgres advisory lock, so three replicas starting
together serialise instead of racing. That race was a real bug — it appeared on
the first CI run against a fresh database and was fixed with the lock. A
migration Job would be the textbook answer; it is redundant here, and adding it
would mean two mechanisms that must agree.

**Liveness does not check dependencies.** `/health` is the liveness probe and
answers only for the process. `/ready` checks Postgres, Redis and OpenSearch and
is the readiness probe. Pointing liveness at `/ready` turns a brief database
blip into a cluster-wide restart storm — strictly worse than serving errors for
a few seconds.

**No CPU limit on the API.** Throttling a Node event loop converts a latency
spike into a failed readiness check and then into a restart. Memory is limited,
because a leak should be killed rather than allowed to swap.

**One wildcard Ingress, not one per tenant.** Tenants are subdomains
([ADR-0012](../../docs/adr/0012-subdomain-tenant-resolution.md)) and resolution
happens inside the storefront from the `Host` header. Onboarding a tenant is a
DNS record and a row in the branding table, not a manifest change. Per-tenant
Ingress objects would make the platform's multi-tenancy the cluster's problem.

**The storefront's cache is an `emptyDir`.** Per-pod and disposable. A shared
volume would put two pods in contention over a cache Next expects to own; the
cost of a cold pod is one upstream query per page, not a wrong page. The mount
itself is not optional — with a read-only root filesystem and nowhere to write,
the container starts, serves pages, and fails every cache write with `EACCES`,
so the cache that revalidation exists to invalidate never exists. That failure
already happened once, in Docker.

**The storefront has no egress rule for any database.** Its NetworkPolicy
permits DNS and the API, and nothing else. The absence is the policy: ESLint
stops the storefront importing across the boundary at build time, and this stops
it reaching a data store at run time.

## What is missing on purpose

No ServiceMonitor or scrape config — OpenTelemetry is designed and not shipped
([ADR-0008](../../docs/adr/0008-opentelemetry-designed-not-shipped.md)), so there
is nothing to scrape yet. No Kustomize overlays or Helm chart: with two
deployables and one environment, a templating layer would be indirection
demonstrating itself. No cluster-issuer, ingress controller or secret-store
manifests — those belong to the cluster, not to this application.

## Applying them, if you ever did

```bash
kubectl apply -f deploy/k8s/00-namespace.yaml

# Secrets come from the cluster's secret store. The *.example.yaml files
# document the required keys; they are templates and are not applied.
kubectl apply -f deploy/k8s/api/          # API-only stops here
kubectl apply -f deploy/k8s/storefront/
```

Rotating the shared revalidate secret is a restart of both, storefront first.
The procedure and what the mismatch window costs are in
[RUNBOOK.md](../../docs/RUNBOOK.md#rotating-the-revalidate-secret).
