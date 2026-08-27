/**
 * @platform/api-client — the ONLY package the storefront may import from.
 *
 * Re-exports the codegen-produced `gql` tag, typed document nodes, and
 * generated result/variable types. Everything the storefront uses to talk
 * to the api should flow through this barrel.
 *
 * Regenerate with:  pnpm nx run api-client:codegen       (GraphQL)
 *                   pnpm nx run api-client:codegen-rest  (REST; api must be up)
 * Refresh schema:   pnpm nx run api-client:fetch-schema  (api must be up)
 */
export * from './generated';
export * from './generated/graphql';

import type { components } from './generated/rest-api';

/**
 * The REST surface, named.
 *
 * These were 124 hand-written lines until the api learned to describe itself:
 * its DTOs were interfaces, `@nestjs/swagger` had no metadata to read, and
 * every body and response in the OpenAPI document was `{}`. Mirroring by hand
 * was the honest answer to that, and a conformance test was the only thing
 * keeping the copy true. Now the api publishes real schemas and
 * `./generated/rest-api` is produced from them, so the copy is gone.
 *
 * Aliases rather than `export *` for two reasons. `openapi-typescript` emits
 * one `components` map, so without these every call site would read
 * `components['schemas']['Cart']`. And this package is the storefront's whole
 * view of the api — deciding what is public belongs here, not in whatever the
 * document happens to contain. A schema that is not named below is not part
 * of the client's surface.
 *
 * Note these are structural aliases into generated output: renaming a schema
 * on the api side breaks this file at build time rather than silently
 * changing what the storefront sees.
 */
type Schema = components['schemas'];

export type Cart = Schema['Cart'];
export type CartLine = Schema['CartLine'];
export type CartWithTotals = Schema['CartWithTotals'];
export type CartTotals = Schema['CartTotals'];
export type CartTotalsLine = Schema['CartTotalsLine'];
export type CartAppliedPromotion = Schema['CartAppliedPromotion'];
export type CreateCartResponse = Schema['CreateCartResponse'];
export type AddItemDto = Schema['AddItemDto'];
export type SetItemQtyDto = Schema['SetItemQtyDto'];
export type ApplyCouponDto = Schema['ApplyCouponDto'];

export type Order = Schema['Order'];
export type OrderLine = Schema['OrderLine'];
export type OrderAppliedPromotion = Schema['OrderAppliedPromotion'];
export type OrderListResponse = Schema['OrderListResponse'];
export type CheckoutDto = Schema['CheckoutDto'];

/** The raw generated document, for anything the aliases above don't cover. */
export type { components, operations, paths } from './generated/rest-api';
