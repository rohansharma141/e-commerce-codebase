import { headers } from 'next/headers';

/**
 * Read the tenant id that `middleware.ts` injected into the request headers.
 * Server Components and the urql server-side client call this. Throws if
 * the middleware didn't run — that's a routing bug, not a recoverable
 * runtime condition.
 */
export function getTenantId(): string {
  const tenantId = headers().get('x-tenant-id');
  if (!tenantId) {
    throw new Error(
      'x-tenant-id missing — middleware.ts should have populated it. ' +
        'If you are seeing this during a build or in a route excluded from ' +
        'the middleware matcher, check the matcher config.',
    );
  }
  return tenantId;
}
