import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Global, Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { DatabaseModule, MIGRATION_RUNNER, type MigrationRunner } from '@platform/shared/database';
import { EventBusModule } from '@platform/shared/event-bus';
import { ChannelsRepository } from './channels.repository';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import {
  CHANNEL_QUERY,
  ChannelReadModelFeeder,
  channelReadModelProvider,
} from './channel-read-model.provider';
import { ChannelReconciler } from './channel-reconciler';

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
 * `@Global`, matching PricingModule and CartModule, so `CHANNEL_QUERY` is
 * available app-wide without a consumer importing this module. That is the only
 * way orders can depend on it at all: a module may not import another module's
 * `src`, so `imports: [ChannelsModule]` in orders would be a build failure.
 *
 * What consumers get is the **token from `contracts/`**, bound to the event-fed
 * read-model (C-14) — not this repository. The distinction is the whole of
 * ADR-0014 §3: a synchronous cross-module read on a write path is both a
 * boundary violation and, after extraction, a network hop inside every
 * checkout. The read-model makes the common case local and the miss correct.
 *
 * The migration runner takes a session advisory lock, so several modules
 * booting concurrently against a cold database serialise rather than racing on
 * `CREATE EXTENSION` — the bug P0-2 fixed.
 */
@Global()
@Module({
  imports: [DatabaseModule, EventBusModule],
  controllers: [ChannelsController],
  providers: [
    ChannelsRepository,
    ChannelsService,
    channelReadModelProvider,
    ChannelReadModelFeeder,
    // Closes the stale-hit gap the feeder leaves: a dropped event is wrong for
    // at most CHANNELS_RECONCILE_MS. Set it to 0 to disable (tests do).
    ChannelReconciler,
  ],
  // CHANNEL_QUERY is the read surface other modules consume (C-16 onwards).
  // ChannelsService stays exported for the composition root only.
  exports: [ChannelsService, CHANNEL_QUERY],
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
