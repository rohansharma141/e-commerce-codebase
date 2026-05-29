import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { currentTenantOrThrow } from '@platform/shared/tenant-context';
import { DATABASE } from './tokens';
import type { PostgresClient } from './pool';
import { withTenantConnection } from './tenant-binding';

/**
 * Runs AFTER TenantContextModule's TenantMiddleware. Reads the tenant that
 * upstream middleware bound, reserves a pooled Postgres connection, sets
 * app.tenant_id on it, then enters next() inside the binding's ALS scope —
 * so every downstream handler/repository's Drizzle calls inherit the tenant.
 * Connection is released when the response closes (success or error).
 */
@Injectable()
export class TenantBindingMiddleware implements NestMiddleware {
  constructor(@Inject(DATABASE) private readonly sql: PostgresClient) {}

  use(_req: Request, res: Response, next: NextFunction): void {
    const ctx = currentTenantOrThrow();
    void withTenantConnection(this.sql, ctx.tenantId, () =>
      new Promise<void>((resolve, reject) => {
        const done = () => {
          res.removeListener('close', done);
          res.removeListener('error', onError);
          resolve();
        };
        const onError = (err: Error) => {
          res.removeListener('close', done);
          res.removeListener('error', onError);
          reject(err);
        };
        res.on('close', done);
        res.on('error', onError);
        next();
      }),
    ).catch(() => {
      // errors already surfaced to express; we just need to ensure the
      // reserved connection is released (the finally in withTenantConnection).
    });
  }
}