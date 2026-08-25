import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseModule, MIGRATION_RUNNER, type MigrationRunner } from '@platform/shared/database';
import { BrandingResolver } from './branding.resolver';
import { ThemeRepository } from './theme.repository';

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
 * Owns the theme table and serves `Query.theme` from it. Pricing keeps a now
 * unread `theme` column until the next step drops it, which is what makes
 * this cutover reversible: the data is in both places, so pointing the
 * resolver back is a one-line revert rather than a restore.
 *
 * Not @Global — nothing injects from branding across module lines. The only
 * consumer is the public graph, and that is reached through the resolver.
 */
@Module({
  imports: [DatabaseModule],
  providers: [ThemeRepository, BrandingResolver],
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
