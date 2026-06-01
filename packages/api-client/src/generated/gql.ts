/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "query CatalogSearch($input: SearchInput!) {\n  search(input: $input) {\n    total\n    latencyMs\n    nextCursor\n    items {\n      id\n      sku\n      name\n      attributes\n    }\n    facets {\n      attribute\n      buckets {\n        value\n        count\n      }\n    }\n  }\n}": typeof types.CatalogSearchDocument,
};
const documents: Documents = {
    "query CatalogSearch($input: SearchInput!) {\n  search(input: $input) {\n    total\n    latencyMs\n    nextCursor\n    items {\n      id\n      sku\n      name\n      attributes\n    }\n    facets {\n      attribute\n      buckets {\n        value\n        count\n      }\n    }\n  }\n}": types.CatalogSearchDocument,
};

/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = gql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function gql(source: string): unknown;

/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "query CatalogSearch($input: SearchInput!) {\n  search(input: $input) {\n    total\n    latencyMs\n    nextCursor\n    items {\n      id\n      sku\n      name\n      attributes\n    }\n    facets {\n      attribute\n      buckets {\n        value\n        count\n      }\n    }\n  }\n}"): (typeof documents)["query CatalogSearch($input: SearchInput!) {\n  search(input: $input) {\n    total\n    latencyMs\n    nextCursor\n    items {\n      id\n      sku\n      name\n      attributes\n    }\n    facets {\n      attribute\n      buckets {\n        value\n        count\n      }\n    }\n  }\n}"];

export function gql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;