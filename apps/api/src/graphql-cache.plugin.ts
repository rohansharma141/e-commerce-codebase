import type { ApolloServerPlugin } from '@apollo/server';

/**
 * Let a GET query be cached, and make it impossible to cache it wrongly.
 *
 * Apollo answers every operation with `cache-control: no-store` unless told
 * otherwise. That is a safe default and it silently defeated the storefront's
 * entire revalidation story: Next.js honours `no-store` on the response and
 * refuses to store it, so `next: { tags, revalidate }` was accepted and had no
 * effect, no route was ever cached, and every `revalidateTag` call invalidated
 * something that was not there.
 *
 * Two rules here, and the second matters more than the first.
 *
 * GET only. A GET GraphQL request is a read by construction — Apollo rejects
 * mutations over GET — so it is the only shape that is safe to describe as
 * cacheable without inspecting the operation. POST keeps `no-store`.
 *
 * `Vary: x-tenant-id`, always, on every GraphQL response including the POSTs
 * that stay uncacheable. The tenant is carried in a header, so a cache keyed
 * on the URL alone would serve one tenant's catalogue to another — the worst
 * failure this system has. Emitting `Vary` even where the response is already
 * uncacheable costs nothing and means the correctness of tenant isolation
 * never depends on someone remembering which branch they are in.
 *
 * `private` keeps shared proxies out of it entirely; `max-age=0` means no
 * client may reuse a response without asking again. Neither constrains
 * Next.js, which caches on its own `revalidate` and tags rather than on these
 * headers — the header's job here is only to stop saying `no-store`.
 */
export const graphqlCachePlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async willSendResponse({ request, response }) {
        response.http.headers.set('vary', 'x-tenant-id');
        if (request.http?.method !== 'GET') return;
        response.http.headers.set('cache-control', 'private, max-age=0');
      },
    };
  },
};
