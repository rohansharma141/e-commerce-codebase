import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Global, Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseModule, MIGRATION_RUNNER, type MigrationRunner } from '@platform/shared/database';
import {
  PRICES_QUERY,
  PROMOTIONS_QUERY,
  TENANT_CONFIG_QUERY,
  TOTALS_SERVICE,
} from '@platform/modules/pricing/contracts';
import { PricesController } from './prices/prices.controller';
import { PricesRepository } from './prices/prices.repository';
import { PricesService } from './prices/prices.service';
import { PromotionsController } from './promotions/promotions.controller';
import { PromotionsRepository } from './promotions/promotions.repository';
import { PromotionsService } from './promotions/promotions.service';
import { TenantConfigController } from './tenant-config/tenant-config.controller';
import { TenantConfigRepository } from './tenant-config/tenant-config.repository';
import { TenantConfigService } from './tenant-config/tenant-config.service';
import { TotalsService } from './totals/totals.service';

export const PRICING_SCHEMA_NAME = 'pricing';

function migrationsDir(): string {
  const candidates = [
    join(__dirname, 'db', 'migrations'),
    join(__dirname, 'migrations', 'pricing'),
    join(process.cwd(), 'migrations', 'pricing'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(`pricing migrations directory not found. Looked in: ${candidates.join(', ')}`);
}

// Cross-module consumers (cart, orders) inject by these tokens from
// @platform/modules/pricing/contracts and never see the concrete classes
// below. @Global so other modules can inject the tokens without listing
// PricingModule in their `imports` array — that listing would be a
// type:src → type:src boundary violation. Composition root (apps/api)
// registers PricingModule once; the tokens are then platform-wide.
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [TenantConfigController, PricesController, PromotionsController],
  providers: [
    TenantConfigRepository,
    TenantConfigService,
    PricesRepository,
    PricesService,
    PromotionsRepository,
    PromotionsService,
    TotalsService,
    { provide: TOTALS_SERVICE, useExisting: TotalsService },
    { provide: PRICES_QUERY, useExisting: PricesRepository },
    { provide: PROMOTIONS_QUERY, useExisting: PromotionsRepository },
    { provide: TENANT_CONFIG_QUERY, useExisting: TenantConfigService },
  ],
  exports: [TOTALS_SERVICE, PRICES_QUERY, PROMOTIONS_QUERY, TENANT_CONFIG_QUERY],
})
export class PricingModule implements OnModuleInit {
  private readonly logger = new Logger(PricingModule.name);
  constructor(@Inject(MIGRATION_RUNNER) private readonly migrations: MigrationRunner) {}

  async onModuleInit(): Promise<void> {
    if (process.env['SKIP_MIGRATIONS'] === '1') {
      this.logger.warn('SKIP_MIGRATIONS=1 — skipping pricing migration on boot');
      return;
    }
    const result = await this.migrations.apply(migrationsDir(), PRICING_SCHEMA_NAME);
    this.logger.log(
      `pricing migrations: applied=${result.applied.length} skipped=${result.skipped.length}`,
    );
  }
}
