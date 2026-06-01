/**
 * @platform/api-client — the ONLY package the storefront may import from.
 *
 * Re-exports the codegen-produced `gql` tag, typed document nodes, and
 * generated result/variable types. Everything the storefront uses to talk
 * to the api should flow through this barrel.
 *
 * Regenerate with:  pnpm nx run api-client:codegen
 * Refresh schema:   pnpm nx run api-client:fetch-schema  (api must be up)
 */
export * from './generated';
export * from './generated/graphql';
