import { Inject, Injectable } from '@nestjs/common';
import { TENANT_DRIZZLE, type TenantDrizzleAccessor } from '@platform/shared/database';
import { auditLog } from './db/schema';

export interface NewAuditEntry {
  readonly tenantId: string;
  readonly actor?: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly requestId: string;
  readonly bodySummary?: unknown;
}

@Injectable()
export class AuditLogRepository {
  constructor(@Inject(TENANT_DRIZZLE) private readonly accessor: TenantDrizzleAccessor) {}
  private get db() {
    return this.accessor.get();
  }

  async insert(entry: NewAuditEntry): Promise<void> {
    await this.db.insert(auditLog).values({
      tenantId: entry.tenantId,
      actor: entry.actor ?? null,
      method: entry.method,
      path: entry.path,
      status: entry.status,
      requestId: entry.requestId,
      bodySummary: (entry.bodySummary as object | null) ?? null,
    });
  }
}
