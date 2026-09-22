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
 * `Vary: x-tenant-id, x-channel-id`, always, on every GraphQL response
 * including the POSTs that stay uncacheable. Both scopes are carried in
 * headers, so a cache keyed on the URL alone would serve one tenant's catalogue
 * to another — the worst failure this system has — or, since C-12, one
 * channel's EUR prices to a shopper on the GBP channel of the same tenant.
 * Emitting `Vary` even where the response is already uncacheable costs nothing
 * and means the correctness of scope isolation never depends on someone
 * remembering which branch they are in.
 *
 * The channel header is listed even though C-2b put the channel *key* in the
 * URL for scoped reads. The header-only `/graphql` path still exists, still
 * honours `x-channel-id`, and was what the storefront used until C-19b;
 * on that path the header is the only thing that distinguishes two channels of
 * one tenant, so `Vary` is what keeps them apart in any cache that respects it.
 * This is defence in depth for the path where the URL cannot help — ADR-0014
 * §2 is explicit that URL scoping does not retire it.
 *
 * `private` keeps shared proxies out of it entirely; `max-age=0` means no
 * client may reuse a response without asking again. Neither constrains
 * Next.js, which caches on its own `revalidate` and tags rather than on these
 * headers — the header's job here is only to stop saying `no-store`.
 */
/**
 * Exported so the storefront's guard spec and the scoped-read spec can assert
 * against the same value the api emits, rather than each restating it.
 */
export const VARY = 'x-tenant-id, x-channel-id';

export const graphqlCachePlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async willSendResponse({ request, response }) {
        response.http.headers.set('vary', VARY);
        if (request.http?.method !== 'GET') return;
        response.http.headers.set('cache-control', 'private, max-age=0');
      },
    };
  },
};
