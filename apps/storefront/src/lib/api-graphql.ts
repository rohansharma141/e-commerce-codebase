import 'server-only';
import { print } from 'graphql';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { getTenantId } from './tenant';

/**
 * Typed GraphQL fetch over Next.js's data cache.
 *
 * Why not urql for the cacheable read path: urql's fetchOptions is global
 * per client, so we can't thread per-query cache tags into it. The Next.js
 * data cache wants `fetch(url, { next: { tags, revalidate } })` per call.
 * Direct `fetch` is the idiomatic choice; we keep the urql client around for
 * any future client-side use (subscriptions, optimistic updates) but every
 * server-rendered read goes through this wrapper.
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
  const res = await fetch(`${API_ORIGIN}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify({
      query: print(document),
      variables,
    }),
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
