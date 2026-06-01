import 'server-only';
import { getTenantId } from './tenant';

/**
 * Server-only REST client for the api.
 *
 * Lives behind a `server-only` import barrier — if a client component
 * accidentally imports it, the build fails. That's the load-bearing
 * security property: the browser never makes a direct request to the api,
 * never sees the api origin, and the tenant header is set by the
 * middleware-bound headers() rather than by anything the user controls.
 *
 * In production, API_ORIGIN points at the internal service host
 * (e.g. http://api:3000). The browser hits Next.js server actions or
 * server-rendered routes, which then hit the api server-to-server.
 */
const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://localhost:3000';

interface ApiRequestOptions {
  /** HTTP method. Defaults to GET. */
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON body — serialized automatically. */
  body?: unknown;
  /** Extra headers (idempotency-key, etc.). */
  headers?: Record<string, string>;
  /** Pass `false` to allow 404 to return null instead of throwing. */
  throwOn404?: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly bodyText: string,
  ) {
    super(`api ${status} on ${path}: ${bodyText.slice(0, 200)}`);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers = {}, throwOn404 = true } = options;
  const tenantId = getTenantId();
  const url = `${API_ORIGIN}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      'x-tenant-id': tenantId,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  if (!res.ok) {
    if (res.status === 404 && !throwOn404) {
      return null as T;
    }
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, path, text);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
