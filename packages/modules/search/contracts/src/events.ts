/**
 * Search read-model events.
 *
 * These announce that the *index* — the thing storefront reads actually hit —
 * now reflects a change, as opposed to the domain events which announce that a
 * write happened.
 *
 * The distinction matters because the bus fans out to subscribers
 * concurrently and awaits none of them. A consumer that listens to
 * `catalog.product.updated` or `pricing.price.upserted` in order to refresh a
 * cache is racing the indexer: if it wins, it rebuilds the cached page from an
 * index that hasn't been updated yet, and the stale render is then cached
 * again until something else invalidates it. Cache invalidation has to be
 * triggered by the read model catching up, not by the write that will
 * eventually cause it to.
 *
 * `search.product.indexed` is therefore emitted only after the document is
 * written AND visible to search, so a consumer that reacts to it can safely
 * re-read.
 */
export const SEARCH_EVENTS = {
  ProductIndexed: 'search.product.indexed',
  ProductRemoved: 'search.product.removed',
} as const;

export type SearchEventName = (typeof SEARCH_EVENTS)[keyof typeof SEARCH_EVENTS];

export interface ProductIndexedPayload {
  readonly tenantId: string;
  readonly productId: string;
  /** What caused the reindex — useful for logs and for consumers that want to
   *  treat a price change differently from a full product edit. */
  readonly reason: 'created' | 'updated' | 'price-changed';
  /**
   * Which category listings this change affects.
   *
   * Values, not routes: a consumer decides for itself what a category listing
   * is called and how it caches one. The api's job is to say which listings
   * stopped being accurate, which it knows and the consumer cannot work out
   * after the fact.
   *
   * On an edit that moves a product between categories this carries BOTH the
   * old and the new value. The old one is the whole reason the field exists —
   * once the document is rewritten, nothing downstream can discover which
   * listing the product just left, and that listing is precisely the one still
   * showing it.
   *
   * Empty when the product has no category attribute. It is not a promise that
   * nothing else changed; a consumer that cannot act on categories should fall
   * back to invalidating everything.
   */
  readonly categories: readonly string[];
}

export interface ProductRemovedPayload {
  readonly tenantId: string;
  readonly productId: string;
  /** The categories the product was listed in before it was removed. */
  readonly categories: readonly string[];
}
