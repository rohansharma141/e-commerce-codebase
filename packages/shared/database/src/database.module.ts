import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '@platform/shared/config';
import { createPostgresClient, type PostgresClient } from './pool';
import { createDrizzle, type DrizzleClient } from './drizzle';
import { MigrationRunner } from './migrator';
import {
  tenantDrizzleAccessor,
  type TenantDrizzleAccessor,
} from './tenant-binding';
import { DATABASE, DRIZZLE, MIGRATION_RUNNER, TENANT_DRIZZLE } from './tokens';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PostgresClient =>
        createPostgresClient(config.DATABASE_URL),
    },
    {
      provide: DRIZZLE,
      inject: [DATABASE],
      useFactory: (sql: PostgresClient): DrizzleClient => createDrizzle(sql),
    },
    {
      // Repositories inject this and call .get() at query time to obtain the
      // request-scoped Drizzle client (built on a reserved connection with
      // app.tenant_id pinned). See tenant-binding.ts.
      provide: TENANT_DRIZZLE,
      useValue: tenantDrizzleAccessor satisfies TenantDrizzleAccessor,
    },
    {
      provide: MIGRATION_RUNNER,
      inject: [DATABASE],
      useFactory: (sql: PostgresClient): MigrationRunner => new MigrationRunner(sql),
    },
  ],
  exports: [DATABASE, DRIZZLE, TENANT_DRIZZLE, MIGRATION_RUNNER],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly sql: PostgresClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
