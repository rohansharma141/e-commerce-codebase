import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Next.js config for the storefront.
 *
 * Three load-bearing pieces here:
 *
 * 1. `transpilePackages: ['@platform/api-client']` — the api-client package
 *    ships as raw TS via the workspace alias; Next must compile it.
 *
 * 2. `output: 'standalone'` + `outputFileTracingRoot` — produces a
 *    self-contained server bundle for the Docker image. The tracing root has
 *    to point at the monorepo root, otherwise Next traces only
 *    apps/storefront and omits the workspace-linked api-client.
 *
 *    Opt-in via NEXT_OUTPUT_STANDALONE (set in the Dockerfile) rather than
 *    always-on. Assembling the standalone bundle symlinks pnpm's store, and
 *    Windows refuses those without Developer Mode or elevation — so an
 *    always-on setting would break `pnpm nx build storefront` for anyone
 *    developing on Windows while working fine in CI and in the image.
 *
 * 3. The security header baseline. Note what is NOT here: the
 *    Content-Security-Policy. `headers()` is evaluated at build time and
 *    returns one static value for every request, which cannot express a
 *    per-request nonce. CSP is therefore issued from `src/middleware.ts`,
 *    which runs per request. Everything that is genuinely static stays here.
 *
 *    Keeping them split means the two files can't silently disagree: this
 *    file owns headers with no request-dependent parts, middleware owns the
 *    one header that has them.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ['@platform/api-client'],
  poweredByHeader: false,
  ...(process.env.NEXT_OUTPUT_STANDALONE ? { output: 'standalone' } : {}),
  experimental: {
    typedRoutes: false,
    outputFileTracingRoot: path.join(dirname, '../../'),
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default config;
