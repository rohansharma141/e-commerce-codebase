# Admin API conventions

What every endpoint under `/admin/*` does the same way. Written for C-1 of the [channels slice](../BACKLOG-channels.md), because Phase B adds channel CRUD and a new endpoint should inherit conventions rather than invent them.

These are **applied, not aspirational.** [`apps/api/src/admin-conventions.integration.spec.ts`](../../apps/api/src/admin-conventions.integration.spec.ts) walks every admin list endpoint and asserts each rule below. Run against the surface as it was before C-1, it reported 16 failures across the four non-conforming endpoints while `/admin/products` passed everything — which is what makes it a check rather than a description.

The bias throughout is **adopt what exists**. `/admin/products` already had cursor pagination and Nest already had an error envelope; C-1 spread those rather than choosing new ones.

---

## 1. Cursor pagination

Every admin list endpoint takes `limit` and `cursor`, and returns `{ items, nextCursor }`.

```
GET /admin/products?limit=25
→ { "items": [ … 25 … ], "nextCursor": "WyIwMDAxYjg3Ny1iODdjLTQ0YTEtOTIzOS1kZTFkYjFmODdkOTEiXQ" }

GET /admin/products?limit=25&cursor=WyIwMDAxYjg3Ny1iODdjLTQ0YTEtOTIzOS1kZTFkYjFmODdkOTEiXQ
→ { "items": [ … next 25 … ], "nextCursor": … }
```

`nextCursor` is `null` on the last page — the key is always present, never omitted.

**`limit` defaults to 50 and is capped at 100.** Out-of-range values clamp rather than error; a non-numeric value falls back to the default. (`/admin/products` previously defaulted to 20. C-1 made it uniform.)

### Cursors are opaque

A cursor is a base64url-encoded JSON array of the sort-key values of the last row on the page. **Clients must not parse one.** Two reasons, both load-bearing:

- The sort key is not always one column. `/admin/orders` sorts newest-first, and `created_at` is not unique — two orders placed in the same millisecond tie. So its cursor carries `(created_at, id)`, and anything that pinned the format to "a uuid" would forbid that.
- When channels land, a cursor may need to record the channel it was issued for. That should be an encoding change, not a breaking change for every consumer.

They are **not** signed or encrypted, and nothing rests on that. A caller who decodes one sees a sort key from a row they already have. Cross-tenant access is not prevented by opacity — RLS never returns the row.

### Why keyset rather than offset

`OFFSET n` on a list that is being written to skips and repeats rows: insert one row before the reader's next page and every subsequent page shifts by one. Keyset pagination asks "the rows after *this* one", which is stable under concurrent writes.

### A total order is mandatory, not decorative

Keyset pagination over an unordered scan is silently wrong — Postgres may return rows in any order between two identical queries, so pages overlap and rows vanish. Before C-1, three of these five endpoints had **no `ORDER BY` at all**. That also made `GET /admin/prices?limit=50` already subtly broken: "the first 50 prices" was not a stable set.

Every sort key below is therefore unique within a tenant, by a constraint rather than by luck:

| Endpoint | Order | Cursor key | Why |
|---|---|---|---|
| `GET /admin/products` | `id ASC` | `id` | PK. |
| `GET /admin/orders` | `created_at DESC, id DESC` | `(created_at, id)` | Newest-first is what the list is for; `id` breaks timestamp ties. Matches the `(tenant_id, created_at DESC)` index. |
| `GET /admin/prices` | `product_id ASC` | `product_id` | The table is keyed `(tenant_id, product_id)` and **has no `id` column**. `updated_at` was never an option: the seeded data holds 99,004 rows across 103 distinct timestamps, so a timestamp keyset would skip ~960 rows per page boundary. |
| `GET /admin/promotions` | `created_at DESC, id DESC` | `(created_at, id)` | As orders. |
| `GET /admin/attribute-definitions` | `code ASC` | `code` | `attribute_definitions_tenant_code_unique` makes it total, and an operator scanning attributes wants them alphabetical, not in UUID order. |

Composite keysets use a row comparison — `(created_at, id) < ($1::timestamptz, $2::uuid)` — rather than an `OR` of two range predicates, so the index is still usable.

> **Implementation note.** Bind ISO strings with explicit casts, never a JS `Date`. A `Date` inside a raw `sql` fragment carries no column type for drizzle to infer, so postgres-js cannot serialise it and throws `ERR_INVALID_ARG_TYPE` at bind time. That is a 500 on page two while page one looks perfect — it is how this was found.

### A malformed cursor is a 400

It is never treated as "start from the beginning". Silently restarting produces a client that loops over page one forever while every individual response looks healthy.

The shared codec lives in [`packages/shared/database/src/cursor.ts`](../../packages/shared/database/src/cursor.ts) — `encodeCursor`, `decodeCursor`, `clampLimit`, `toPage`. New list endpoints use it rather than hand-rolling; that is what keeps the five interchangeable.

---

## 2. Error envelope

**Nest's default shape, unchanged:**

```json
{ "message": "…", "error": "Not Found", "statusCode": 404 }
```

Deliberately not replaced. Every endpoint already returns it and the storefront already handles it, so a new envelope would be a breaking change across the whole surface bought for nothing.

| Status | When |
|---|---|
| `400` | Malformed input: a bad cursor, an unparseable uuid, a missing tenant header. |
| `404` | No such resource **for this tenant**. A row belonging to another tenant reports as not-found rather than forbidden — RLS makes it invisible, and saying "forbidden" would confirm it exists. |
| `409` | Optimistic-concurrency conflict. See below. |

### The 409 body

Conflicts extend the envelope with the current version, so a client can re-read and retry without a second round trip:

```json
{ "message": "…", "error": "Conflict", "statusCode": 409, "currentVersion": 7 }
```

Nothing returns `409` yet — versioned resources arrive with channels in C-9. The shape is fixed here so C-9 adopts it rather than inventing one.

---

## 3. Partial update

`PATCH` merges; it does not replace. The distinction that matters, and the reason this is written down before channels exist:

- **Field omitted** → leave it alone.
- **Field explicitly `null`** → set it to null.

For channels, `null` means *inherit from tenant defaults*, so the two are genuinely different operations and a merge that collapsed them would make "stop overriding this" unexpressible.

---

## 4. Idempotency on creates

Convention: `POST` creates accept an `idempotency-key` header; a repeat with the same key returns the original resource rather than creating a second.

**Stated, not yet shared.** The only implementation is checkout's, private to `checkout.service.ts` with its own table in the orders schema. Extracting it is [C-28](../BACKLOG-channels.md); until then this section describes checkout's behaviour and the intended shape, and no admin create honours it.

---

## 5. Filtering and sorting

Filters are query parameters named for the field they filter (`?active=true`). Sorting is `?sort=field` / `?sort=-field` for descending.

**Neither is implemented on any admin endpoint yet**, and this section is a placeholder for the grammar so that the first endpoint to need one does not invent a second. Note the constraint from §1: any sort option must be a total order, or its cursor breaks.

---

## 6. Scope

`/admin/*` is **tenant-scoped only** — the tenant comes from `x-tenant-id` and there is no URL segment.

This will not change when channels add `/api/{tenant}/{channelKey}/graphql` to the read edge. Admin *manages* channels, so scoping a channel-management call to a single channel is theatre. Recorded as a non-goal in [ADR-0014 §2](../adr/0014-channel-as-sales-channel.md) and gate G-2 so nobody later "completes" the pattern.

---

## 7. OpenAPI

Every admin operation declares its request and response types, so `/docs-json` carries real schemas and `packages/api-client` can be generated rather than hand-mirrored.

The decorated classes live in each module's `src/` (`catalog.schema.ts`, `pricing.schema.ts`, `orders.schema.ts`, `cart.schema.ts`), implementing the matching `contracts/` interface. **Not in `contracts/`** — those packages have zero dependencies, and `@ApiProperty` would put `@nestjs/swagger` inside the surface a consumer imports. `implements Contract.X` is what stops the class drifting from the contract without a type error.

CI regenerates from a live `/docs-json` and fails if the committed client is stale (R-4), so a DTO change that skips regeneration cannot merge.
