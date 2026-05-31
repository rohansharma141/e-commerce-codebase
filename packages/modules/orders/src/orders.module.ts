import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseModule, MIGRATION_RUNNER, type MigrationRunner } from '@platform/shared/database';
import { CheckoutService } from './checkout.service';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';

export const ORDERS_SCHEMA_NAME = 'orders';

function migrationsDir(): string {
  const candidates = [
    join(__dirname, 'db', 'migrations'),
    join(__dirname, 'migrations', 'orders'),
    join(process.cwd(), 'migrations', 'orders'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(`orders migrations directory not found. Looked in: ${candidates.join(', ')}`);
}

// PricingModule and CartModule are @Global; their exported tokens
// (TOTALS_SERVICE, PRICES_QUERY, PROMOTIONS_QUERY, TENANT_CONFIG_QUERY,
// CART_SERVICE) are available app-wide without orders importing those
// modules directly. The composition root (apps/api) wires both.
@Module({
  imports: [DatabaseModule],
  controllers: [OrdersController],
  providers: [OrdersRepository, CheckoutService],
  exports: [OrdersRepository, CheckoutService],
})
export class OrdersModule implements OnModuleInit {
  private readonly logger = new Logger(OrdersModule.name);
  constructor(@Inject(MIGRATION_RUNNER) private readonly migrations: MigrationRunner) {}

  async onModuleInit(): Promise<void> {
    if (process.env['SKIP_MIGRATIONS'] === '1') {
      this.logger.warn('SKIP_MIGRATIONS=1 — skipping orders migration on boot');
      return;
    }
    const result = await this.migrations.apply(migrationsDir(), ORDERS_SCHEMA_NAME);
    this.logger.log(
      `orders migrations: applied=${result.applied.length} skipped=${result.skipped.length}`,
    );
  }
}
