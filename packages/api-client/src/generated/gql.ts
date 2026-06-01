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
    "query ProductDetail($id: ID!) {\n  product(id: $id) {\n    id\n    sku\n    name\n    attributes\n  }\n}": typeof types.ProductDetailDocument,
    "query TenantTheme {\n  theme {\n    brandName\n    tagline\n    logoMark\n    brandHsl\n    brandFgHsl\n    pageBgHsl\n    fontSans\n  }\n}": typeof types.TenantThemeDocument,
};
const documents: Documents = {
    "query CatalogSearch($input: SearchInput!) {\n  search(input: $input) {\n    total\n    latencyMs\n    nextCursor\n    items {\n      id\n      sku\n      name\n      attributes\n    }\n    facets {\n      attribute\n      buckets {\n        value\n        count\n      }\n    }\n  }\n}": types.CatalogSearchDocument,
    "query ProductDetail($id: ID!) {\n  product(id: $id) {\n    id\n    sku\n    name\n    attributes\n  }\n}": types.ProductDetailDocument,
    "query TenantTheme {\n  theme {\n    brandName\n    tagline\n    logoMark\n    brandHsl\n    brandFgHsl\n    pageBgHsl\n    fontSans\n  }\n}": types.TenantThemeDocument,
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
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "query ProductDetail($id: ID!) {\n  product(id: $id) {\n    id\n    sku\n    name\n    attributes\n  }\n}"): (typeof documents)["query ProductDetail($id: ID!) {\n  product(id: $id) {\n    id\n    sku\n    name\n    attributes\n  }\n}"];
/**
 * The gql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function gql(source: "query TenantTheme {\n  theme {\n    brandName\n    tagline\n    logoMark\n    brandHsl\n    brandFgHsl\n    pageBgHsl\n    fontSans\n  }\n}"): (typeof documents)["query TenantTheme {\n  theme {\n    brandName\n    tagline\n    logoMark\n    brandHsl\n    brandFgHsl\n    pageBgHsl\n    fontSans\n  }\n}"];

export function gql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;