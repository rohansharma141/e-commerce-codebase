import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Global, Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule, MIGRATION_RUNNER, type MigrationRunner } from '@platform/shared/database';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLogRepository } from './audit-log.repository';
import { PlatformThrottlerModule } from './throttler.module';

export const AUDIT_SCHEMA_NAME = 'audit';

function migrationsDir(): string {
  const candidates = [
    join(__dirname, 'db', 'migrations'),
    join(__dirname, 'migrations', 'audit'),
    join(process.cwd(), 'migrations', 'audit'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(`audit migrations directory not found. Looked in: ${candidates.join(', ')}`);
}

@Global()
@Module({
  imports: [DatabaseModule, PlatformThrottlerModule],
  providers: [
    AuditLogRepository,
    AuditLogInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: AuditLogInterceptor },
  ],
  exports: [AuditLogRepository],
})
export class SecurityModule implements OnModuleInit {
  private readonly logger = new Logger(SecurityModule.name);
  constructor(@Inject(MIGRATION_RUNNER) private readonly migrations: MigrationRunner) {}

  async onModuleInit(): Promise<void> {
    if (process.env['SKIP_MIGRATIONS'] === '1') return;
    const result = await this.migrations.apply(migrationsDir(), AUDIT_SCHEMA_NAME);
    this.logger.log(
      `audit migrations: applied=${result.applied.length} skipped=${result.skipped.length}`,
    );
  }
}
