export type ProductAttributes = Record<string, unknown>;

export interface Product {
  readonly id: string;
  readonly tenantId: string;
  readonly sku: string;
  readonly name: string;
  readonly attributes: ProductAttributes;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProductDto {
  readonly sku: string;
  readonly name: string;
  readonly attributes?: ProductAttributes;
}

export interface UpdateProductDto {
  readonly sku?: string;
  readonly name?: string;
  readonly attributes?: ProductAttributes;
}

export interface ListProductsQuery {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ListProductsResult {
  readonly items: readonly Product[];
  readonly nextCursor: string | null;
}
