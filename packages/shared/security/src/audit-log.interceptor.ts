import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import type { Request, Response } from 'express';
import { currentTenant } from '@platform/shared/tenant-context';
import { AuditLogRepository } from './audit-log.repository';
import { redactBody } from './redactor';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records every successful mutation under /admin/* or /storefront/checkout
 * to the audit_log table. Failures (5xx, thrown exceptions) are NOT audited —
 * the application logs already carry those, and the audit log's job is the
 * "what changed" story, which requires a successful write to have happened.
 *
 * Best-effort: a failure to write the audit row never blocks the request.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly repo: AuditLogRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // GraphQL execution contexts don't carry an Express req/res; skip them.
    // The audit log targets admin/storefront-checkout REST mutations only.
    if (context.getType<string>() !== 'http') {
      return next.handle();
    }
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    if (!shouldAudit(req)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => this.record(req, res),
      }),
    );
  }

  private record(req: Request, res: Response): void {
    const tenant = currentTenant();
    if (!tenant) return; // /health and /ready are excluded from tenant binding
    if (res.statusCode >= 400) return;

    void this.repo
      .insert({
        tenantId: tenant.tenantId,
        method: req.method,
        path: req.originalUrl ?? req.url,
        status: res.statusCode,
        requestId: tenant.requestId,
        bodySummary: redactBody(req.body),
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `failed to write audit_log row (req=${tenant.requestId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }
}

function shouldAudit(req: Request): boolean {
  if (!MUTATING_METHODS.has(req.method)) return false;
  const url = req.originalUrl ?? req.url ?? '';
  if (url.startsWith('/admin/')) return true;
  if (url.startsWith('/storefront/checkout')) return true;
  return false;
}
