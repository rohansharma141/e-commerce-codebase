export interface FacetBucket {
  readonly value: string;
  readonly count: number;
}

export interface Facet {
  readonly attribute: string;
  readonly buckets: readonly FacetBucket[];
}
