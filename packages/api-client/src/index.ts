/**
 * @platform/api-client — the ONLY package the storefront may import from.
 *
 * Re-exports the codegen-produced `gql` tag, typed document nodes, and
 * generated result/variable types. Everything the storefront uses to talk
 * to the api should flow through this barrel.
 *
 * Regenerate with:  pnpm nx run api-client:codegen
 * Refresh schema:   pnpm nx run api-client:fetch-schema  (api must be up)
 *
 * The REST half is mid-migration. `./generated/rest-api` is produced from the
 * api's own OpenAPI document by `pnpm nx run api-client:codegen-rest` (api
 * must be up) and is committed, but nothing imports it yet: `./rest` is still
 * the hand-written mirror the storefront compiles against. Swapping the two is
 * its own step, so that it can fail on its own.
 */
export * from './generated';
export * from './generated/graphql';
export * from './rest';
