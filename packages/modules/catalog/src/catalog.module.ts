import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseModule, MIGRATION_RUNNER, type MigrationRunner } from '@platform/shared/database';
import { AttributeDefinitionsController } from './attribute-definitions/attribute-definitions.controller';
import { AttributeDefinitionsRepository } from './attribute-definitions/attribute-definitions.repository';
import { AttributeDefinitionsService } from './attribute-definitions/attribute-definitions.service';
import { AttributeValidator } from './products/attribute-validator';
import { ProductsController } from './products/products.controller';
import { ProductsRepository } from './products/products.repository';
import { ProductsService } from './products/products.service';

export const CATALOG_SCHEMA_NAME = 'catalog';

/**
 * Resolves to the on-disk migrations directory whether running from ts-node/dev
 * (where __dirname points into packages/...) or from the bundled api dist
 * (where migrations are copied to dist/apps/api/migrations/catalog by the
 * webpack asset rule).
 */
function migrationsDir(): string {
  const candidates = [
    join(__dirname, 'db', 'migrations'),
    join(__dirname, 'migrations', 'catalog'),
    join(process.cwd(), 'migrations', 'catalog'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    `catalog migrations directory not found. Looked in: ${candidates.join(', ')}`,
  );
}

@Module({
  imports: [DatabaseModule],
  controllers: [AttributeDefinitionsController, ProductsController],
  providers: [
    AttributeDefinitionsRepository,
    AttributeDefinitionsService,
    ProductsRepository,
    AttributeValidator,
    ProductsService,
  ],
})
export class CatalogModule implements OnModuleInit {
  private readonly logger = new Logger(CatalogModule.name);

  constructor(@Inject(MIGRATION_RUNNER) private readonly migrations: MigrationRunner) {}

  async onModuleInit(): Promise<void> {
    if (process.env['SKIP_MIGRATIONS'] === '1') {
      this.logger.warn('SKIP_MIGRATIONS=1 — skipping catalog migration on boot');
      return;
    }
    const result = await this.migrations.apply(migrationsDir(), CATALOG_SCHEMA_NAME);
    this.logger.log(
      `catalog migrations: applied=${result.applied.length} skipped=${result.skipped.length}`,
    );
  }
}
