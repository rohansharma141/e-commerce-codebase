import type { NextFunction, Request, Response } from 'express';

/**
 * URL-scoped GraphQL reads (C-2).
 *
 *   GET|POST /api/{tenant}/graphql   → handled as /graphql, tenant asserted
 *   GET|POST /graphql                → unchanged; the shipped storefront keeps working
 *
 * ── Why the URL carries scope at all ──────────────────────────────────────
 *
 * Cacheability and trust are different problems (ADR-0014 §2). The URL is a
 * **cache key** — every cache in the chain keys on it with no configuration.
 * The header is the **trust input**. Today nothing shared caches these
 * responses (`cache-control: private`), so this is about retrofit asymmetry:
 * changing the URL shape once integrations, bookmarks and cache keys depend on
 * it is brutal, and carrying scope from the start costs almost nothing.
 *
 * `scoped-graphql.integration.spec.ts` demonstrates the failure this prevents
 * against a proxy that keys on URL alone: one tenant is served another's
 * cached body, at a layer the application cannot observe.
 *
 * ── The security rule, which is not deferrable ────────────────────────────
 *
 * The tenant resolves from `x-tenant-id` ONLY. The URL segment is asserted to
 * match it, and a mismatch is a 400.
 *
 * Resolving from the URL instead would let a crafted path override whatever
 * the gateway bound — a direct route into another tenant's data. "Prefer the
 * header" is equally wrong: silently picking a winner turns a mismatch into an
 * exploit rather than an error. This is why C-2 and C-3 landed as one commit:
 * routing the path without the assertion would ship a window in which
 * `/api/{victim}/graphql` served whatever the caller's header asked for.
 *
 * ── Why `/api` is a reserved prefix ───────────────────────────────────────
 *
 * Tenant ids match /^[a-zA-Z0-9._-]{1,64}$/, which admits `admin`, `health`
 * and `graphql`. A bare `/{tenant}/…` grammar would let a legitimately-named
 * tenant collide with a real route — a bug that shows up only when someone
 * signs up with an unlucky name. The prefix puts tenant ids one level down,
 * where they cannot be mistaken for route names.
 *
 * ── The channel segment (C-2b) ───────────────────────────────────────────
 *
 *   GET|POST /api/{tenant}/{channelKey}/graphql   an explicit channel
 *   GET|POST /api/{tenant}/graphql                the tenant's default
 *
 * The segment is **omitted, not sentinelled**, for the default. ADR-0014 §4
 * argues against reserving the literal `default` as a channel key because an
 * operator may legitimately want it; an optional segment removes the reserved
 * word entirely, so "unspecified" is structural rather than a magic value.
 *
 * It carries the **key**, not the id — §4 makes `key` immutable precisely
 * because it appears in URLs, and putting a UUID here would make that
 * reasoning false and the logs unreadable.
 *
 * This middleware only asserts the segment against the header. Actually
 * resolving the channel — and returning 404 for an unknown, archived or
 * cross-tenant one — is `ChannelScopeMiddleware` (C-12), which runs later and
 * has the tenant-bound database connection this one does not.
 */

/** Same shape the tenant middleware validates, so the two cannot disagree. */
const TENANT_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;

/** `/api/{tenant}/graphql` — the tenant's default channel. */
const SCOPED_PATH_RE = /^\/api\/([^/?#]+)\/graphql\/?$/;

/** `/api/{tenant}/{channelKey}/graphql` — an explicit channel (C-2b). */
const CHANNEL_SCOPED_PATH_RE = /^\/api\/([^/?#]+)\/([^/?#]+)\/graphql\/?$/;

const TENANT_HEADER = 'x-tenant-id';
const CHANNEL_HEADER = 'x-channel-id';

/**
 * Replies with the same envelope Nest produces, by hand.
 *
 * This middleware runs via `app.use()`, ahead of the Nest router, so a thrown
 * `BadRequestException` would reach Express's default error handler rather than
 * Nest's exception filter — and come back as HTML. Writing the body directly is
 * what keeps a scope mismatch looking like every other 400 on the surface.
 */
function badRequest(res: Response, message: string): void {
  res.status(400).json({ message, error: 'Bad Request', statusCode: 400 });
}

export function scopedGraphqlMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // `req.url` carries the query string; match on the path alone so
    // `?query=…` (the GET read path) still routes.
    const [path, query] = splitUrl(req.url);

    // Four segments before /graphql means a channel was named; three means the
    // tenant's default. The two forms are distinguished by length alone, which
    // is why a channel keyed `graphql` is unambiguous rather than a collision:
    // /api/t/graphql is three segments and means the default, while
    // /api/t/graphql/graphql is four and names that channel.
    const channelMatch = CHANNEL_SCOPED_PATH_RE.exec(path);
    const match = channelMatch ?? SCOPED_PATH_RE.exec(path);
    if (!match) {
      next();
      return;
    }

    if (channelMatch) {
      const urlChannel = channelMatch[2] as string;
      const chanHeaderVal = req.headers[CHANNEL_HEADER];
      const headerChannel = Array.isArray(chanHeaderVal) ? chanHeaderVal[0] : chanHeaderVal;

      // Same rule as the tenant: the header is the trust input and the URL is
      // asserted against it. A URL segment that could establish channel scope
      // on its own would let a crafted path read a market the gateway did not
      // grant — and "prefer the header" would turn that mismatch into an
      // exploit rather than an error.
      //
      // A missing channel header alongside a channel URL is rejected too. It is
      // not "unspecified": the caller asked for a specific channel, and serving
      // the default instead would answer a question nobody asked.
      if (typeof headerChannel !== 'string' || headerChannel.trim().length === 0) {
        badRequest(
          res,
          `the URL names channel "${urlChannel}" but no ${CHANNEL_HEADER} header was ` +
            `sent. The header is the trust input; the URL cannot establish scope on ` +
            `its own. Omit the channel segment to use the tenant default.`,
        );
        return;
      }
      if (headerChannel.trim() !== urlChannel) {
        badRequest(
          res,
          `scope mismatch: URL names channel "${urlChannel}" but ${CHANNEL_HEADER} ` +
            `names "${headerChannel.trim()}". The header is the trust input; the URL ` +
            `must agree with it.`,
        );
        return;
      }
    }

    const urlTenant = match[1] as string;
    if (!TENANT_ID_RE.test(urlTenant)) {
      badRequest(res, `tenant segment must match ${TENANT_ID_RE.source}`);
      return;
    }

    const headerVal = req.headers[TENANT_HEADER];
    const headerTenant = Array.isArray(headerVal) ? headerVal[0] : headerVal;

    // A missing header is deliberately NOT handled here. Falling through lets
    // TenantMiddleware produce its usual "Missing or empty x-tenant-id"
    // response, so the scoped path and the unscoped one fail identically
    // rather than growing a second dialect of the same error.
    if (typeof headerTenant === 'string' && headerTenant.trim().length > 0) {
      if (headerTenant.trim() !== urlTenant) {
        badRequest(
          res,
          `scope mismatch: URL names tenant "${urlTenant}" but ${TENANT_HEADER} ` +
            `names "${headerTenant.trim()}". The header is the trust input; the ` +
            `URL must agree with it.`,
        );
        return;
      }
    }

    // Hand the request to the existing /graphql pipeline untouched. Rewriting
    // rather than re-registering Apollo means there is exactly one GraphQL
    // handler, so the scoped path cannot drift from the unscoped one.
    req.url = query === undefined ? '/graphql' : `/graphql?${query}`;
    next();
  };
}

function splitUrl(url: string): [string, string | undefined] {
  const i = url.indexOf('?');
  return i === -1 ? [url, undefined] : [url.slice(0, i), url.slice(i + 1)];
}
