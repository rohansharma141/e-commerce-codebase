/**
 * Next.js config for the storefront.
 *
 * Two load-bearing pieces here:
 *
 * 1. `transpilePackages: ['@platform/api-client']` — the api-client package
 *    ships as raw TS via the workspace alias; Next must compile it.
 *
 * 2. The `headers()` security baseline — strict CSP (no inline scripts),
 *    DENY framing, no Referer leakage, locked-down browser-feature
 *    permissions. Style tags get 'unsafe-inline' because Tailwind emits a
 *    lot of utility CSS and Next injects nonces only for scripts in the
 *    14.x app router.
 *
 *    `connect-src` includes the api origin and the Next.js dev websocket.
 *    Tighten this for production: drop `ws:` and the wildcard localhost.
 */

const isDev = process.env.NODE_ENV !== 'production';
const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:3000';

const cspDirectives = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'" + (isDev ? " 'unsafe-eval'" : ''),
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}${isDev ? ' ws://localhost:* http://localhost:*' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Content-Security-Policy', value: cspDirectives.join('; ') },
];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ['@platform/api-client'],
  poweredByHeader: false,
  experimental: {
    typedRoutes: false,
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default config;
