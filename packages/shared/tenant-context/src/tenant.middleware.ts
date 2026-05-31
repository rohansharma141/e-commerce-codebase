import { BadRequestException, Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenant, type TenantContext } from './tenant-context';

export const TENANT_HEADER = 'x-tenant-id';
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Tenant id shape: alnum + dot/dash/underscore, 1-64 chars. Matches the
 * tighter regex enforced by TenantRedisClient and OpenSearch's index-name
 * slug rules so a header that would otherwise break log keys, redis
 * namespaces, or OS index names is rejected at the door.
 */
const TENANT_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;

/**
 * Reads x-tenant-id, validates shape, binds it (plus a propagated or
 * generated x-request-id) for the request via AsyncLocalStorage. Fails
 * closed — missing or malformed header is a 400, never a silent default.
 * Real auth (JWT/OIDC) replacing this lives upstream of the api in
 * production deployments; see docs/adr/0007.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const headerVal = req.headers[TENANT_HEADER];
    const tenantIdRaw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!tenantIdRaw || typeof tenantIdRaw !== 'string') {
      throw new BadRequestException(`Missing or empty ${TENANT_HEADER} header`);
    }
    const tenantId = tenantIdRaw.trim();
    if (!TENANT_ID_RE.test(tenantId)) {
      throw new BadRequestException(
        `${TENANT_HEADER} must match ${TENANT_ID_RE.source}`,
      );
    }

    const requestIdHeader = req.headers[REQUEST_ID_HEADER];
    const incomingRequestId = Array.isArray(requestIdHeader)
      ? requestIdHeader[0]
      : requestIdHeader;
    const requestId =
      typeof incomingRequestId === 'string' && incomingRequestId.length > 0
        ? incomingRequestId
        : randomUUID();

    // Echo the id back so callers can correlate against their own logs.
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const ctx: TenantContext = { tenantId, requestId };
    runWithTenant(ctx, () => next());
  }
}
