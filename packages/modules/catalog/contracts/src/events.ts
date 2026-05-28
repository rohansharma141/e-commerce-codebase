import type { AttributeDefinition } from './attribute-types';
import type { Product } from './product.dto';

export const CATALOG_EVENTS = {
  AttributeDefinitionCreated: 'catalog.attribute-definition.created',
  ProductCreated: 'catalog.product.created',
  ProductUpdated: 'catalog.product.updated',
  ProductDeleted: 'catalog.product.deleted',
} as const;

export type CatalogEventName = (typeof CATALOG_EVENTS)[keyof typeof CATALOG_EVENTS];

export interface AttributeDefinitionCreatedPayload {
  readonly definition: AttributeDefinition;
}

export interface ProductCreatedPayload {
  readonly product: Product;
}

export interface ProductUpdatedPayload {
  readonly product: Product;
  readonly previous: Product;
}

export interface ProductDeletedPayload {
  readonly product: Product;
}
