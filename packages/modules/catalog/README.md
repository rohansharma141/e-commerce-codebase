# modules/catalog

Products + tenant-defined typed attributes. The signature feature commercetools made famous: tenants declare their own attributes (e.g. `color: enum<red|blue>`, `weight_kg: number`) and products use them.

## Public surface (`contracts/`)

- `Product`, `CreateProductDto`, `UpdateProductDto`, `ListProductsResult`
- `AttributeDefinition`, `AttributeType`, `AttributeConfigByType`
- `CATALOG_EVENTS` — `attribute-definition.created`, `product.created`, `product.updated`, `product.deleted`
- Event payload types: `ProductCreatedPayload`, `ProductUpdatedPayload`, etc.

## Internals (`src/`)

- `db/schema.ts` — `catalog.attribute_definitions`, `catalog.products`
- `db/migrations/0001_init.sql`, `0002_rls.sql`
- `attribute-definitions/` — repo + service + REST controller under `/admin/attribute-definitions`
- `products/products.{repository,service,controller}.ts` — REST under `/admin/products`
- `products/attribute-validator.ts` — validates product `attributes` against the tenant's `attribute_definitions` (string/number/boolean/enum/date, with multi-value support)
- `catalog.module.ts` — applies migrations on boot

## REST endpoints

Under `/admin/*`. All require `x-tenant-id`. Validations:

| Endpoint | Method | Body | Notes |
|---|---|---|---|
| `/admin/attribute-definitions` | POST | `CreateAttributeDefinitionDto` | code regex `^[a-z][a-z0-9_]*$`; enum requires `config.allowedValues` |
| `/admin/attribute-definitions` | GET | — | tenant-scoped list |
| `/admin/products` | POST | `CreateProductDto` | sku regex `^[A-Za-z0-9._-]{1,64}$`; attributes validated dynamically against the tenant's defs |
| `/admin/products` | GET | — | paginated by `?limit&?cursor` |
| `/admin/products/:id` | GET, PATCH, DELETE | | |

## Events

After every product write, `CATALOG_EVENTS.{ProductCreated,ProductUpdated,ProductDeleted}` is published on the in-process bus. Payloads carry the full product snapshot — see CLAUDE.md's "events are network-strict" discipline. The search indexer consumes them.

## Hooks

After a successful product create, `HOOK_NAMES.ProductAfterCreate` fires (`{ id, sku, name }` payload). Observer-only. See [ADR-0009](../../../docs/adr/0009-hooks-as-typed-in-process-registry.md).

## Tests of note

- `attribute-validator.spec.ts` — type validation per attribute type, multi-value arrays, enum allowedValues, range checks, date ISO normalisation
- `catalog.integration.spec.ts` — full repo + service exercises against real Postgres with tenant binding
- `rls-isolation.integration.spec.ts` — **the killshot**: unbound session sees 0 rows; per-tenant raw `SELECT *` only returns own rows; cross-tenant INSERT rejected by RLS

## Deliberately not built

- Variants, options, configurable products — the catalog stays narrow
- Categories — modeled as an attribute today
- Image upload / CDN integration
- Bulk import via CSV
