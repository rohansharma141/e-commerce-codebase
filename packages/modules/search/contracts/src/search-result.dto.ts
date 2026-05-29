import type { Facet } from './facet.dto';

export interface ProductHit {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly attributes: Record<string, unknown>;
}

export interface SearchResult {
  readonly items: readonly ProductHit[];
  readonly facets: readonly Facet[];
  readonly total: number;
  readonly nextCursor: string | null;
  readonly latencyMs: number;
}
