import { NextResponse, type NextRequest } from 'next/server';

/**
 * Tenant resolution from the Host header.
 *
 * Production: `t-fashion.commerce.example.com` → tenant `t-fashion`.
 * Local dev:  `t-fashion.localhost:3001` → tenant `t-fashion`. Modern
 *             browsers resolve `*.localhost` natively, so no /etc/hosts edits.
 *
 * The middleware sets an internal `x-tenant-id` request header (NOT a
 * response header) that downstream Server Components and the urql client
 * read via `headers()` from `next/headers`. The api requires this header on
 * every tenant-scoped call; resolving it here means no Server Component or
 * client query needs to know how tenants are identified.
 *
 * A bare `localhost` request (no subdomain) redirects to the default tenant
 * so the developer experience is "open localhost:3001 and see something".
 * In production we'd return 404 instead; document that switch when the
 * production domain lands.
 */

const DEFAULT_DEV_TENANT = 't-fashion';
const TENANT_RE = /^([a-zA-Z0-9._-]+)\.(localhost|.+)(?::\d+)?$/;
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'admin']);

const IS_DEV = process.env.NODE_ENV !== 'production';
const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://localhost:3000';

/**
 * Per-request Content-Security-Policy.
 *
 * Next.js 14 streams the RSC payload and React's hydration data through
 * inline <script> blocks. A blanket `script-src 'self'` blocks them, so a
 * production build renders static HTML that never hydrates — no add-to-cart,
 * no autocomplete, no quantity controls. A per-request nonce is the only way
 * to keep inline scripts out of the policy while still allowing the
 * framework's own.
 *
 * The nonce is set on the REQUEST headers as well as the response: Next.js
 * reads the inbound `content-security-policy` header, extracts the nonce, and
 * stamps it onto every script tag it emits. Setting it only on the response
 * would produce a policy that blocks the very scripts the page needs.
 *
 * `'strict-dynamic'` lets the nonced bootstrap load the chunk scripts without
 * enumerating them; CSP3 browsers ignore `'self'` for scripts once it's
 * present, and `'self'` remains for older ones.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "img-src 'self' data: https:",
    // Tailwind emits utility CSS through inline style tags; Next does not
    // nonce styles in the 14.x app router, so this stays as-is.
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${IS_DEV ? " 'unsafe-eval' 'unsafe-inline'" : ''}`,
    "font-src 'self' data:",
    `connect-src 'self' ${API_ORIGIN}${IS_DEV ? ' ws://localhost:* http://localhost:*' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function middleware(req: NextRequest): NextResponse {
  const host = req.headers.get('host') ?? '';
  const match = TENANT_RE.exec(host);
  const candidate = match?.[1];

  let tenantId: string | null = null;
  if (candidate && !RESERVED_SUBDOMAINS.has(candidate)) {
    tenantId = candidate;
  }

  if (!tenantId) {
    // No subdomain on a bare localhost / IP — redirect dev users to the
    // default tenant rather than failing with a 400.
    const isLocalDev = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    if (isLocalDev) {
      const url = req.nextUrl.clone();
      const port = host.includes(':') ? `:${host.split(':')[1]}` : '';
      url.host = `${DEFAULT_DEV_TENANT}.localhost${port}`;
      return NextResponse.redirect(url);
    }
    return new NextResponse('Tenant required (no subdomain on host)', {
      status: 400,
    });
  }

  const nonce = crypto.randomUUID();
  const csp = buildCsp(nonce);

  const headers = new Headers(req.headers);
  headers.set('x-tenant-id', tenantId);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy', csp);
  return res;
}

export const config = {
  // Run on every request except Next internals, static asset paths, and
  // /api/revalidate (the only api route that's called server-to-server
  // and authenticates by bearer secret + body-carried tenant id, not by
  // subdomain). Every other /api/* route — /api/suggest, future tenant-
  // scoped JSON endpoints — DOES go through the middleware so it gets
  // x-tenant-id from the Host header automatically.
  matcher: ['/((?!_next/|api/revalidate|favicon.ico|.*\\..*).*)'],
};
