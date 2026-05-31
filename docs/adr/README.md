# Architecture Decision Records

Load-bearing decisions, each documented to be interrogable on its own. A reviewer can read any single ADR and understand both what we chose and what we rejected.

| # | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith-not-microservices.md) | Modular monolith, not microservices | Accepted |
| [0002](0002-build-from-scratch-not-on-medusa.md) | Build from scratch, not on Medusa | Accepted |
| [0003](0003-rls-not-where-only.md) | Postgres RLS as the enforcement backstop, not WHERE-only | Accepted |
| [0004](0004-index-per-tenant-on-opensearch.md) | Index-per-tenant on OpenSearch | Accepted |
| [0005](0005-money-as-integer-cents-bankers-rounding.md) | Money as integer cents with banker's rounding | Accepted |
| [0006](0006-best-single-stacking-for-promotions.md) | Best-single stacking for promotions | Accepted |
| [0007](0007-tenant-id-as-trust-gateway-responsibility.md) | Tenant id as trust = gateway responsibility | Accepted (with caveats) |
| [0008](0008-opentelemetry-designed-not-shipped.md) | OpenTelemetry designed, not shipped | Accepted |
| [0009](0009-hooks-as-typed-in-process-registry.md) | Hooks as a typed in-process registry | Accepted |

ADR format follows [Michael Nygard's template](https://github.com/joelparkerhenderson/architecture-decision-record/blob/main/locales/en/templates/decision-record-template-by-michael-nygard/index.md). Each is 100–250 lines, lives forever (decisions never get deleted — only superseded with a new ADR), and links to concrete code paths and tests.
