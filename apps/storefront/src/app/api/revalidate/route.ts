import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { browseAllTag, browseTag, categoryTag } from '@/lib/cache-tags';

/**
 * Cache revalidation webhook.
 *
 * The api POSTs here when a catalog event fires. Authenticated via a shared
 * secret (Bearer token); without a valid secret the route returns 401 so
 * an attacker cannot pile up revalidation work as a DoS vector.
 *
 * Payload shape is event-shaped, NOT tag-shaped. The api emits "what
 * happened" semantically — the storefront knows what tags those events
 * should invalidate. This keeps tag naming a storefront-side concern; the
 * api never needs to learn the storefront's cache topology.
 *
 *   POST /api/revalidate
 *   Authorization: Bearer <REVALIDATE_SECRET>
 *   Content-Type: application/json
 *   {
 *     "event": "search.product.indexed" | "search.product.removed"
 *            | "pricing.promotion.created" | "pricing.promotion.updated"
 *            | "pricing.tenant-config.updated"
 *            | <legacy catalog.product.* / pricing.price.upserted>,
 *     "tenantId": "t-fashion",
 *     "productId": "abc-...-123"        // product-scoped events only
 *   }
 *
 * If REVALIDATE_SECRET is unset on the storefront, the route refuses every
 * request — same posture as the api's tenant middleware, fail-closed.
 */

const SECRET = process.env['REVALIDATE_SECRET'];

interface RevalidatePayload {
  event: string;
  tenantId: string;
  productId?: string;
  /**
   * Which category listings the api says are affected. Absent means it did not
   * say — an older api, or a tenant-wide event — and the broad browse tag is
   * used instead. Present but empty means it looked and the product is in no
   * category, so only the unscoped listings need dropping.
   */
  categories?: string[];
  deliveryId?: string;
}

/**
 * Delivery ids already acted on.
 *
 * The api delivers from a transactional outbox, which is at-least-once: a
 * webhook whose response is lost gets retried even though the work was done.
 * Re-invalidating a tag is harmless in itself, but a retry storm would have
 * every cached render for a tenant dropped repeatedly, so duplicates are
 * cheap to ignore and worth ignoring.
 *
 * In-memory and bounded, which is the right trade here: the failure mode of
 * losing it (a restart, or a second instance) is doing an idempotent
 * invalidation twice. Reaching for shared storage would buy nothing.
 */
const MAX_SEEN = 512;
const seenDeliveries = new Set<string>();

function alreadyHandled(deliveryId: string | undefined): boolean {
  if (!deliveryId) return false;
  if (seenDeliveries.has(deliveryId)) return true;
  seenDeliveries.add(deliveryId);
  if (seenDeliveries.size > MAX_SEEN) {
    // Sets iterate in insertion order, so this drops the oldest.
    const oldest = seenDeliveries.values().next().value;
    if (oldest) seenDeliveries.delete(oldest);
  }
  return false;
}

/**
 * Drop the listings a single product change affects.
 *
 * Unscoped listings always go: the home page, search and the suggestion cache
 * show products from everywhere. Category pages go one at a time, which is the
 * point — an edit to a laptop must not cost the other five category pages
 * their caches.
 *
 * `undefined` categories fall back to the tenant-wide tag. That is the
 * deploy-skew path: an api that predates this field still emits product
 * events, and treating "did not say" as "affects nothing" would leave category
 * pages stale for an hour. Over-invalidating is the safe direction.
 */
function invalidateBrowse(
  tenantId: string,
  categories: string[] | undefined,
  invalidated: string[],
): void {
  const all = browseAllTag(tenantId);
  revalidateTag(all);
  invalidated.push(all);

  if (categories === undefined) {
    const broad = browseTag(tenantId);
    revalidateTag(broad);
    invalidated.push(broad);
    return;
  }

  for (const category of categories) {
    const tag = categoryTag(tenantId, category);
    revalidateTag(tag);
    invalidated.push(tag);
  }
}

function unauthorized(message = 'unauthorized'): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 401 });
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!SECRET) {
    return unauthorized('REVALIDATE_SECRET not configured on the storefront');
  }

  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${SECRET}`) {
    return unauthorized();
  }

  let body: RevalidatePayload;
  try {
    body = (await req.json()) as RevalidatePayload;
  } catch {
    return badRequest('invalid JSON body');
  }

  if (!body.event || typeof body.event !== 'string') {
    return badRequest('event is required');
  }
  if (!body.tenantId || typeof body.tenantId !== 'string') {
    return badRequest('tenantId is required');
  }

  // Ack duplicates with 200: a retry that gets a 4xx would be retried again,
  // and the api is right to consider this delivered.
  if (alreadyHandled(body.deliveryId)) {
    return NextResponse.json({ ok: true, duplicate: true, invalidated: [] });
  }

  const invalidated: string[] = [];

  switch (body.event) {
    case 'catalog.product.created':
    case 'catalog.product.deleted': {
      // A new/removed product changes browse pages (different facet
      // counts, different totals). If we know the productId, the PDP for
      // a deleted product needs to flip to 404 too.
      invalidateBrowse(body.tenantId, body.categories, invalidated);
      if (body.productId) {
        const tag = `product:${body.tenantId}:${body.productId}`;
        revalidateTag(tag);
        invalidated.push(tag);
      }
      break;
    }
    case 'catalog.product.updated': {
      // An edit affects the PDP and browse pages (since name/attributes
      // surface there too).
      if (!body.productId) {
        return badRequest('productId is required for catalog.product.updated');
      }
      const pTag = `product:${body.tenantId}:${body.productId}`;
      revalidateTag(pTag);
      invalidateBrowse(body.tenantId, body.categories, invalidated);
      // The PDP path tag is sufficient for most stores but the path-level
      // revalidate guarantees the route's RSC cache flips too.
      revalidatePath(`/p/${body.productId}`);
      invalidated.push(pTag, `/p/${body.productId}`);
      break;
    }
    case 'search.product.indexed':
    case 'search.product.removed': {
      // The api sends these once the search index — which is what every
      // storefront read actually queries — reflects the change. Whatever
      // caused it (a product edit, a new product, a price change) has already
      // landed, so a rebuild triggered here is guaranteed to see current data.
      //
      // Deliberately one branch for all of them: the storefront's concern is
      // "this product's rendering is out of date", not why. Browse is
      // invalidated alongside the PDP because cards carry name, price and
      // stock, and facet counts shift when a product appears or disappears.
      if (!body.productId) {
        return badRequest(`productId is required for ${body.event}`);
      }
      const pTag = `product:${body.tenantId}:${body.productId}`;
      revalidateTag(pTag);
      invalidateBrowse(body.tenantId, body.categories, invalidated);
      revalidatePath(`/p/${body.productId}`);
      invalidated.push(pTag, `/p/${body.productId}`);
      break;
    }
    case 'pricing.price.upserted': {
      // Retained for deploy skew only. The api routes price changes through
      // search.product.indexed now; an older api still emits this, and
      // handling both means the two deployables can be rolled independently
      // without a stale-cache window. Safe to delete once no deployed api
      // emits it.
      if (!body.productId) {
        return badRequest('productId is required for pricing.price.upserted');
      }
      const pTag = `product:${body.tenantId}:${body.productId}`;
      revalidateTag(pTag);
      invalidateBrowse(body.tenantId, body.categories, invalidated);
      revalidatePath(`/p/${body.productId}`);
      invalidated.push(pTag, `/p/${body.productId}`);
      break;
    }
    case 'pricing.promotion.created':
    case 'pricing.promotion.updated':
    case 'pricing.tenant-config.updated': {
      // Tenant-wide: a promotion or a tax-rate change can alter the totals on
      // any page for this tenant, and there's no id to narrow it to. Cart and
      // checkout render dynamically so they need no invalidation; the browse
      // set and the theme do.
      // The broad tag, deliberately: every browse page carries it, including
      // the per-category ones, because a promotion changes prices everywhere.
      const bTag = browseTag(body.tenantId);
      const aTag = browseAllTag(body.tenantId);
      const tTag = `theme:${body.tenantId}`;
      // Capabilities carry the currency and its minor-unit exponent, which
      // every rendered price depends on. A tenant switching currency without
      // this would leave the whole catalogue formatted in the old one until
      // the hourly fallback expired.
      const cTag = `capabilities:${body.tenantId}`;
      revalidateTag(bTag);
      revalidateTag(aTag);
      revalidateTag(tTag);
      revalidateTag(cTag);
      invalidated.push(bTag, aTag, tTag, cTag);
      break;
    }
    default: {
      // Unknown event: ack with a no-op rather than 4xx so the api's
      // dispatcher doesn't retry-storm a deploy-skew. Log for observability.
      // eslint-disable-next-line no-console
      console.warn(`[revalidate] unknown event: ${body.event}`);
    }
  }

  return NextResponse.json({ ok: true, invalidated });
}
