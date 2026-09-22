import 'server-only';
import { print } from 'graphql';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { defaultChannelKey, requestChannelKey } from './channel-key';
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
 * post, hence `apollo-require-preflight`. The tenant travels in a header, which
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
  constructor(
    message: string,
    readonly errors: unknown,
    /** The HTTP status when the api refused the request outright. */
    readonly status?: number,
  ) {
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
  /**
   * Read in the tenant's default channel, whatever the path named. Only for the
   * root layout's frame around an unknown channel's `404`: the frame must
   * render, and nothing can be asked in a channel that does not exist — the
   * api answers every such read `404`, the theme included. The frame's links
   * already go to the default, so its theme comes from there too.
   */
  inDefaultChannel?: boolean;
}

/**
 * Every read names the request's channel (C-19b): `/api/{tenant}/{channelKey}/graphql`
 * with `x-channel-id`, the api's own grammar (C-2b). The header is what the
 * api trusts and the URL is what caches key on; the api refuses the request if
 * they disagree, so both are always sent together.
 *
 * The channel is read here, per call, as the tenant is — not passed by each
 * caller, where one forgotten argument would read the default channel's
 * catalogue and prices on another channel's page. An unprefixed page names
 * the default by its key (`requestChannelKey`), so no read depends on the
 * api's missing-channel fallback, which C-42 removes.
 */
export async function graphqlQuery<TData, TVars>(
  document: TypedDocumentNode<TData, TVars>,
  variables: TVars,
  options: QueryOptions = {},
): Promise<TData> {
  const tenantId = getTenantId();
  const channelKey = options.inDefaultChannel
    ? await defaultChannelKey()
    : await requestChannelKey();
  const params = new URLSearchParams({ query: print(document) });
  if (variables && Object.keys(variables as object).length > 0) {
    params.set('variables', JSON.stringify(variables));
  }

  const headers: Record<string, string> = {
    'x-tenant-id': tenantId,
    // Apollo Server refuses GET queries without evidence that the request
    // was not a simple cross-origin form post. Without this the api answers
    // 400 and every page fails to render.
    'apollo-require-preflight': 'true',
  };
  // The key is used as it arrived in the storefront's own path — already a
  // valid, percent-encoded path segment — and is not encoded again. The api
  // compares the URL segment with the header byte for byte, so encoding one
  // and not the other would turn an unknown channel's `404` into a mismatch
  // `400`.
  let path = '/graphql';
  if (channelKey) {
    path = `/api/${tenantId}/${channelKey}/graphql`;
    headers['x-channel-id'] = channelKey;
  }

  const res = await fetch(`${API_ORIGIN}${path}?${params.toString()}`, {
    headers,
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
      res.status,
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
