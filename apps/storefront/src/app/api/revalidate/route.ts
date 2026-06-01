import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';

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
 *     "event": "catalog.product.updated" | "catalog.product.created"
 *            | "catalog.product.deleted",
 *     "tenantId": "t-fashion",
 *     "productId": "abc-...-123"        // optional for "created"
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

  const invalidated: string[] = [];

  switch (body.event) {
    case 'catalog.product.created':
    case 'catalog.product.deleted': {
      // A new/removed product changes browse pages (different facet
      // counts, different totals). If we know the productId, the PDP for
      // a deleted product needs to flip to 404 too.
      const browse = `browse:${body.tenantId}`;
      revalidateTag(browse);
      invalidated.push(browse);
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
      const bTag = `browse:${body.tenantId}`;
      revalidateTag(pTag);
      revalidateTag(bTag);
      // The PDP path tag is sufficient for most stores but the path-level
      // revalidate guarantees the route's RSC cache flips too.
      revalidatePath(`/p/${body.productId}`);
      invalidated.push(pTag, bTag, `/p/${body.productId}`);
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
