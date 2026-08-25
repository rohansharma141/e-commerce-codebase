import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseModule, MIGRATION_RUNNER, type MigrationRunner } from '@platform/shared/database';

export const BRANDING_SCHEMA_NAME = 'branding';

function migrationsDir(): string {
  const candidates = [
    join(__dirname, 'db', 'migrations'),
    join(__dirname, 'migrations', 'branding'),
    join(process.cwd(), 'migrations', 'branding'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(`branding migrations directory not found. Looked in: ${candidates.join(', ')}`);
}

/**
 * Branding module — owns per-tenant storefront theming.
 *
 * At this point in the extraction it owns storage and nothing else: the table
 * exists and carries a copy of every theme, while `Query.theme` is still
 * served by the pricing module reading its own column. Both copies are live
 * and identical, which is what makes the next step a cutover rather than a
 * migration — the resolver moves once, with the data already in place, and
 * can be reverted by pointing it back.
 *
 * Deliberately not @Global: nothing injects from branding yet. It becomes a
 * provider of a repository and resolver in the next step.
 */
@Module({
  imports: [DatabaseModule],
})
export class BrandingModule implements OnModuleInit {
  private readonly logger = new Logger(BrandingModule.name);
  constructor(@Inject(MIGRATION_RUNNER) private readonly migrations: MigrationRunner) {}

  async onModuleInit(): Promise<void> {
    if (process.env['SKIP_MIGRATIONS'] === '1') return;
    const result = await this.migrations.apply(migrationsDir(), BRANDING_SCHEMA_NAME);
    this.logger.log(
      `branding migrations: applied=${result.applied.length} skipped=${result.skipped.length}`,
    );
  }
}
