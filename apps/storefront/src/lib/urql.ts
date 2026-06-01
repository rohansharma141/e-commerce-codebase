import { registerUrql } from '@urql/next/rsc';
import { cacheExchange, createClient, fetchExchange } from '@urql/core';
import { getTenantId } from './tenant';

/**
 * urql client wired for React Server Components via @urql/next/rsc.
 *
 * One client per request (registerUrql wraps the factory in React.cache).
 * The fetch options closure runs at fetch time, so headers() is read in
 * the request's async-context — that's how the tenant id flows from
 * middleware → into the api call.
 *
 * In production the API_ORIGIN env var should point at the internal api
 * service hostname (e.g. http://api:3000). NEXT_PUBLIC_ is intentionally
 * NOT used here — server-only.
 */
const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://localhost:3000';

function makeClient() {
  return createClient({
    url: `${API_ORIGIN}/graphql`,
    exchanges: [cacheExchange, fetchExchange],
    fetchOptions: () => ({
      headers: {
        'x-tenant-id': getTenantId(),
      },
      // Force `fetch` not to cache aggressively — Next dedupes via its own
      // Request Memoization; we don't need urql layering on top.
      cache: 'no-store' as RequestCache,
    }),
  });
}

export const { getClient } = registerUrql(makeClient);
