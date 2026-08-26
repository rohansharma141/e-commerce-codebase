/**
 * Cache tag vocabulary.
 *
 * Tag naming is a storefront concern and stays here. The api sends events
 * describing what changed — a product was indexed, these category listings are
 * affected — and never learns what a page is called or how it is cached. That
 * separation is why the api can be sold without this storefront at all.
 *
 * Three browse tags rather than one, because they answer different questions:
 *
 *   browse:<tenant>                    every browse-ish page. Only tenant-wide
 *                                      changes use it — a promotion, a
 *                                      currency switch, a tax rate. Also the
 *                                      fallback when an event arrives without
 *                                      category information.
 *
 *   browse:<tenant>:all                listings with no category filter: the
 *                                      home page, search, suggestions, the
 *                                      related-products strip. Any product
 *                                      change can alter these, so they are
 *                                      dropped on every product event.
 *
 *   browse:<tenant>:category:<slug>    one category listing. Editing a laptop
 *                                      drops the laptop page and leaves the
 *                                      other five warm, which is the whole
 *                                      point of the split.
 *
 * A category page carries the tenant-wide tag AND its own, so it still
 * responds to a promotion while ignoring an edit in a category it does not
 * show.
 */

export function browseTag(tenantId: string): string {
  return `browse:${tenantId}`;
}

export function browseAllTag(tenantId: string): string {
  return `browse:${tenantId}:all`;
}

/**
 * Normalised so that the value the api sends and the slug in the URL land on
 * the same tag. `/c/Laptop` and a stored value of `laptop ` have to invalidate
 * each other or the split silently stops working — a page that is never
 * invalidated looks exactly like a page that is correctly cached.
 */
export function categoryTag(tenantId: string, category: string): string {
  return `browse:${tenantId}:category:${normaliseCategory(category)}`;
}

export function normaliseCategory(category: string): string {
  return category.trim().toLowerCase();
}
