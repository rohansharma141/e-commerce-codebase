import 'server-only';
import { print } from 'graphql';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { getTenantId } from './tenant';

/**
 * Typed GraphQL reads, cached and tagged.
 *
 * Why not urql for the cacheable read path: urql's fetchOptions is global
 * per client, so we can't thread per-query cache tags into it. We keep the
 * urql client around for any future client-side use (subscriptions,
 * optimistic updates) but every server-rendered read goes through here.
 *
 * Reads go over GET, which is the whole reason any of this caches.
 *
 * This used to POST. Next's data cache only stores GET responses: it accepts
 * `next: { tags, revalidate }` on a POST and ignores it, with no warning and
 * no error. Every route stayed dynamic, every read reached the api, and every
 * `revalidateTag` call in the webhook route invalidated nothing. The failure
 * was invisible because an empty cache is never stale — the storefront was
 * correct, and silently much slower than the architecture doc claimed.
 *
 * `unstable_cache` was tried first, since it caches a function's result rather
 * than an HTTP response and so does not care about the method. It did not
 * help: an uncacheable fetch inside it makes the surrounding entry
 * uncacheable too, so the reads stayed uncached with the added cost of a
 * hand-built cache key. Measured, not assumed — five consecutive requests for
 * the same page produced five `search.completed` lines in the api log.
 *
 * GET needs no api change: the schema already serves queries over GET. Apollo
 * blocks them unless the request proves it is not a simple cross-origin form
 * post, hence `apollo-require-preflight`. The tenant stays in a header, which
 * Next includes in the cache key — the isolation test in
 * `api-graphql.spec.ts` is what holds that claim down, because a tenant
 * leaking out of a shared cache entry would be the worst bug this codebase
 * could have.
 *
 * Tag conventions used by the storefront:
 *
 *   product:<tenantId>:<productId>     — single product detail
 *   browse:<tenantId>                  — every browse page (tenant-wide changes)
 *   browse:<tenantId>:all              — listings with no category filter
 *   browse:<tenantId>:category:<slug>  — one category listing
 *   theme:<tenantId>                   — the tenant's theme
 *   capabilities:<tenantId>            — currency, locale, tax display
 *
 * The /api/revalidate route translates incoming events from the api into
 * revalidateTag calls against these tags. The vocabulary and the reasoning
 * behind the three browse tags live in `@/lib/cache-tags`.
 */
const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://localhost:3000';

export class GraphqlError extends Error {
  constructor(message: string, readonly errors: unknown) {
    super(message);
    this.name = 'GraphqlError';
  }
}

interface QueryOptions {
  /** Cache tags. Invalidated by revalidateTag from the webhook route. */
  tags?: string[];
  /**
   * Time-based fallback in seconds. `false` = cached until a tag fires.
   * Defaults to 1 hour — a generous safety net so dropped webhooks don't
   * leave stale content forever.
   */
  revalidate?: number | false;
}

export async function graphqlQuery<TData, TVars>(
  document: TypedDocumentNode<TData, TVars>,
  variables: TVars,
  options: QueryOptions = {},
): Promise<TData> {
  const tenantId = getTenantId();
  const params = new URLSearchParams({ query: print(document) });
  if (variables && Object.keys(variables as object).length > 0) {
    params.set('variables', JSON.stringify(variables));
  }

  const res = await fetch(`${API_ORIGIN}/graphql?${params.toString()}`, {
    headers: {
      'x-tenant-id': tenantId,
      // Apollo Server refuses GET queries without evidence that the request
      // was not a simple cross-origin form post. Without this the api answers
      // 400 and every page fails to render.
      'apollo-require-preflight': 'true',
    },
    next: {
      tags: options.tags,
      revalidate: options.revalidate ?? 3600,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GraphqlError(
      `api graphql HTTP ${res.status}: ${body.slice(0, 200)}`,
      null,
    );
  }

  const json = (await res.json()) as { data?: TData; errors?: unknown };
  if (json.errors) {
    throw new GraphqlError(
      `api graphql returned errors`,
      json.errors,
    );
  }
  if (!json.data) {
    throw new GraphqlError('api graphql returned no data', null);
  }
  return json.data;
}
