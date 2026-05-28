import { BadRequestException, Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenant, type TenantContext } from './tenant-context';

export const TENANT_HEADER = 'x-tenant-id';
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Step-1 tenant resolution: read x-tenant-id off the request and bind it for the
 * lifetime of the request via AsyncLocalStorage. Fails closed — no header is a
 * 400, never a silent default. Real resolution (JWT claim, subdomain, etc.)
 * lands in step 3 (multi-tenancy hardening).
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const headerVal = req.headers[TENANT_HEADER];
    const tenantId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new BadRequestException(`Missing or empty ${TENANT_HEADER} header`);
    }

    const requestIdHeader = req.headers[REQUEST_ID_HEADER];
    const incomingRequestId = Array.isArray(requestIdHeader)
      ? requestIdHeader[0]
      : requestIdHeader;
    const requestId =
      typeof incomingRequestId === 'string' && incomingRequestId.length > 0
        ? incomingRequestId
        : randomUUID();

    const ctx: TenantContext = { tenantId: tenantId.trim(), requestId };
    runWithTenant(ctx, () => next());
  }
}
