import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseModule, MIGRATION_RUNNER, type MigrationRunner } from '@platform/shared/database';
import { ChannelsRepository } from './channels.repository';

export const CHANNELS_SCHEMA_NAME = 'channels';

function migrationsDir(): string {
  const candidates = [
    join(__dirname, 'db', 'migrations'),
    join(__dirname, 'migrations', 'channels'),
    join(process.cwd(), 'migrations', 'channels'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(`channels migrations directory not found. Looked in: ${candidates.join(', ')}`);
}

/**
 * Channels module — owns sales channels and per-tenant configuration defaults.
 *
 * Not `@Global`. Other modules will consume channel configuration through
 * event-replicated read-models (C-14), never by injecting this repository
 * across a module line — a synchronous cross-module read on a write path is
 * both a boundary violation and a latency multiplier (ADR-0014 §3).
 *
 * The migration runner takes a session advisory lock, so several modules
 * booting concurrently against a cold database serialise rather than racing on
 * `CREATE EXTENSION` — the bug P0-2 fixed.
 */
@Module({
  imports: [DatabaseModule],
  providers: [ChannelsRepository],
  exports: [ChannelsRepository],
})
export class ChannelsModule implements OnModuleInit {
  private readonly logger = new Logger(ChannelsModule.name);
  constructor(@Inject(MIGRATION_RUNNER) private readonly migrations: MigrationRunner) {}

  async onModuleInit(): Promise<void> {
    if (process.env['SKIP_MIGRATIONS'] === '1') return;
    const result = await this.migrations.apply(migrationsDir(), CHANNELS_SCHEMA_NAME);
    this.logger.log(
      `channels migrations: applied=${result.applied.length} skipped=${result.skipped.length}`,
    );
  }
}
