export interface Price {
  readonly tenantId: string;
  readonly productId: string;
  readonly unitPriceCents: number;
  readonly updatedAt: string;
}

export interface UpsertPriceDto {
  readonly productId: string;
  readonly unitPriceCents: number;
}
