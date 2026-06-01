import { NextResponse, type NextRequest } from 'next/server';
import { CatalogSearchDocument } from '@platform/api-client';
import { graphqlQuery } from '@/lib/api-graphql';

/**
 * Type-ahead suggestions for the search bar. Returns the top 8 product hits
 * for the supplied query. The tenant header is set by middleware (this
 * route IS in the middleware matcher), so the query is naturally tenant-
 * scoped without any extra plumbing.
 *
 *   GET /api/suggest?q=shir   →   { items: [{id, name, sku, price?}, ...] }
 *
 * Cached briefly per (tenant, q) so a flurry of keystrokes on the same
 * prefix don't all hit OpenSearch. Tagged `browse:<tenant>` so a catalog
 * mutation invalidates it alongside the browse pages.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  // Below two characters the suggestions are noise; bail early.
  if (q.length < 2) {
    return NextResponse.json({ items: [] });
  }

  const tenantId = req.headers.get('x-tenant-id') ?? '';

  try {
    const data = await graphqlQuery(
      CatalogSearchDocument,
      {
        input: {
          query: q,
          limit: 8,
          facets: [],
          filters: [],
          autocomplete: true,
        },
      },
      { tags: [`browse:${tenantId}`], revalidate: 30 },
    );
    const items = data.search.items.map((p) => {
      const attrs = (p.attributes ?? {}) as Record<string, unknown>;
      const price =
        typeof attrs['price'] === 'number' ? (attrs['price'] as number) : null;
      return { id: p.id, name: p.name, sku: p.sku, price };
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
