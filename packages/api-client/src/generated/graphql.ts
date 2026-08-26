/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf). */
  JSON: { input: any; output: any; }
};

export type AttributeFilterInput = {
  attribute: Scalars['String']['input'];
  eq?: InputMaybe<Scalars['String']['input']>;
  gte?: InputMaybe<Scalars['Float']['input']>;
  in?: InputMaybe<Array<Scalars['String']['input']>>;
  lte?: InputMaybe<Scalars['Float']['input']>;
};

/** What this API supports, for the calling tenant. */
export type CapabilitiesType = {
  __typename?: 'CapabilitiesType';
  /** Version of the platform serving this request. */
  apiVersion: Scalars['String']['output'];
  /** False when this tenant has no pricing configuration yet, in which case currency and taxRateBps are platform defaults rather than real settings. */
  configured: Scalars['Boolean']['output'];
  /** ISO 4217 code this tenant trades in. */
  currency: Scalars['String']['output'];
  /** Decimal places in the currency. Every money value in this API is an integer in minor units: 19999 with minorUnits 2 is 199.99. A consumer that assumes 2 will be wrong for JPY. */
  currencyMinorUnits: Scalars['Int']['output'];
  defaultLocale: Scalars['String']['output'];
  features: Array<CapabilityFeature>;
  /** BCP-47 tags this deployment can serve. */
  locales: Array<Scalars['String']['output']>;
  taxDisplay: TaxDisplay;
  /** Tax rate in basis points. 875 is 8.75%. */
  taxRateBps: Scalars['Int']['output'];
  tenantId: Scalars['String']['output'];
};

/** A named capability of this deployment. */
export type CapabilityFeature = {
  __typename?: 'CapabilityFeature';
  enabled: Scalars['Boolean']['output'];
  /** Stable dotted key, e.g. promotions.coupon */
  key: Scalars['String']['output'];
};

export type FacetBucketType = {
  __typename?: 'FacetBucketType';
  count: Scalars['Int']['output'];
  value: Scalars['String']['output'];
};

export type FacetType = {
  __typename?: 'FacetType';
  attribute: Scalars['String']['output'];
  buckets: Array<FacetBucketType>;
};

export type ProductHitType = {
  __typename?: 'ProductHitType';
  attributes: Scalars['JSON']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type Query = {
  __typename?: 'Query';
  capabilities: CapabilitiesType;
  product?: Maybe<ProductHitType>;
  search: SearchResultType;
  theme: StorefrontThemeType;
};


export type QueryProductArgs = {
  id: Scalars['ID']['input'];
};


export type QuerySearchArgs = {
  input: SearchInput;
};

export type SearchInput = {
  autocomplete?: InputMaybe<Scalars['Boolean']['input']>;
  cursor?: InputMaybe<Scalars['String']['input']>;
  facets?: InputMaybe<Array<Scalars['String']['input']>>;
  filters?: InputMaybe<Array<AttributeFilterInput>>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
  sort?: InputMaybe<SortOption>;
};

export type SearchResultType = {
  __typename?: 'SearchResultType';
  facets: Array<FacetType>;
  items: Array<ProductHitType>;
  latencyMs: Scalars['Int']['output'];
  nextCursor?: Maybe<Scalars['String']['output']>;
  total: Scalars['Int']['output'];
};

export enum SortOption {
  NameAsc = 'NAME_ASC',
  PriceAsc = 'PRICE_ASC',
  PriceDesc = 'PRICE_DESC',
  Relevance = 'RELEVANCE'
}

export type StorefrontThemeType = {
  __typename?: 'StorefrontThemeType';
  brandFgHsl: Scalars['String']['output'];
  brandHsl: Scalars['String']['output'];
  brandName: Scalars['String']['output'];
  fontSans: Scalars['String']['output'];
  logoMark: Scalars['String']['output'];
  pageBgHsl: Scalars['String']['output'];
  pageFgHsl: Scalars['String']['output'];
  tagline: Scalars['String']['output'];
};

/** Whether listed prices include tax. */
export enum TaxDisplay {
  Exclusive = 'EXCLUSIVE',
  Inclusive = 'INCLUSIVE'
}

export type TenantCapabilitiesQueryVariables = Exact<{ [key: string]: never; }>;


export type TenantCapabilitiesQuery = { __typename?: 'Query', capabilities: { __typename?: 'CapabilitiesType', currency: string, currencyMinorUnits: number, defaultLocale: string } };

export type CatalogSearchQueryVariables = Exact<{
  input: SearchInput;
}>;


export type CatalogSearchQuery = { __typename?: 'Query', search: { __typename?: 'SearchResultType', total: number, latencyMs: number, nextCursor?: string | null, items: Array<{ __typename?: 'ProductHitType', id: string, sku: string, name: string, attributes: any }>, facets: Array<{ __typename?: 'FacetType', attribute: string, buckets: Array<{ __typename?: 'FacetBucketType', value: string, count: number }> }> } };

export type ProductDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ProductDetailQuery = { __typename?: 'Query', product?: { __typename?: 'ProductHitType', id: string, sku: string, name: string, attributes: any } | null };

export type TenantThemeQueryVariables = Exact<{ [key: string]: never; }>;


export type TenantThemeQuery = { __typename?: 'Query', theme: { __typename?: 'StorefrontThemeType', brandName: string, tagline: string, logoMark: string, brandHsl: string, brandFgHsl: string, pageBgHsl: string, pageFgHsl: string, fontSans: string } };


export const TenantCapabilitiesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TenantCapabilities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"capabilities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"currencyMinorUnits"}},{"kind":"Field","name":{"kind":"Name","value":"defaultLocale"}}]}}]}}]} as unknown as DocumentNode<TenantCapabilitiesQuery, TenantCapabilitiesQueryVariables>;
export const CatalogSearchDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CatalogSearch"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SearchInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"search"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"latencyMs"}},{"kind":"Field","name":{"kind":"Name","value":"nextCursor"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"facets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"attribute"}},{"kind":"Field","name":{"kind":"Name","value":"buckets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"count"}}]}}]}}]}}]}}]} as unknown as DocumentNode<CatalogSearchQuery, CatalogSearchQueryVariables>;
export const ProductDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ProductDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"product"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"}}]}}]}}]} as unknown as DocumentNode<ProductDetailQuery, ProductDetailQueryVariables>;
export const TenantThemeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TenantTheme"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"theme"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"brandName"}},{"kind":"Field","name":{"kind":"Name","value":"tagline"}},{"kind":"Field","name":{"kind":"Name","value":"logoMark"}},{"kind":"Field","name":{"kind":"Name","value":"brandHsl"}},{"kind":"Field","name":{"kind":"Name","value":"brandFgHsl"}},{"kind":"Field","name":{"kind":"Name","value":"pageBgHsl"}},{"kind":"Field","name":{"kind":"Name","value":"pageFgHsl"}},{"kind":"Field","name":{"kind":"Name","value":"fontSans"}}]}}]}}]} as unknown as DocumentNode<TenantThemeQuery, TenantThemeQueryVariables>;