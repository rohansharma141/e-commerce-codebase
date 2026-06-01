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

  const headers = new Headers(req.headers);
  headers.set('x-tenant-id', tenantId);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Run on every request except Next internals and static asset paths.
  matcher: ['/((?!_next/|favicon.ico|.*\\..*).*)'],
};
