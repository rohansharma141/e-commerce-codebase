import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '@platform/shared/config';
import { createPostgresClient, type PostgresClient } from './pool';
import { createDrizzle, type DrizzleClient } from './drizzle';
import { MigrationRunner } from './migrator';
import { DATABASE, DRIZZLE, MIGRATION_RUNNER } from './tokens';

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
      provide: MIGRATION_RUNNER,
      inject: [DATABASE],
      useFactory: (sql: PostgresClient): MigrationRunner => new MigrationRunner(sql),
    },
  ],
  exports: [DATABASE, DRIZZLE, MIGRATION_RUNNER],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly sql: PostgresClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
