import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * Codegen for @platform/api-client.
 *
 * Schema source: `packages/api-client/schema.graphql` — a copy of the live
 * api's SDL. Refresh it with `pnpm nx run api-client:fetch-schema` while the
 * api container is running.
 *
 * Operations source: `packages/api-client/src/operations/*.graphql` — the
 * `.graphql` files defining the queries/mutations the storefront uses.
 *
 * Output: `packages/api-client/src/generated/` — TypedDocumentNode-based
 * (uses `@graphql-typed-document-node/core`), works with any client (urql,
 * Apollo, graphql-request). The storefront imports the typed documents
 * and the result types from `@platform/api-client`.
 *
 * Generated files are committed so `pnpm install && pnpm build` works in CI
 * without needing to spin up the api first.
 */
const config: CodegenConfig = {
  schema: 'packages/api-client/schema.graphql',
  documents: ['packages/api-client/src/operations/**/*.graphql'],
  generates: {
    'packages/api-client/src/generated/': {
      preset: 'client',
      presetConfig: {
        gqlTagName: 'gql',
      },
    },
  },
  ignoreNoDocuments: true,
};

export default config;
