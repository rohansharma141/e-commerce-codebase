import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE, type PostgresClient } from '@platform/shared/database';
import { OPENSEARCH, type OpenSearchClient } from '@platform/shared/opensearch';
import { REDIS, type RedisClient } from '@platform/shared/redis';

export type DepStatus = 'up' | 'down';

export interface ReadinessReport {
  readonly ok: boolean;
  readonly deps: Record<string, DepStatus>;
}

const PROBE_TIMEOUT_MS = 1000;

/**
 * Per-dep readiness check. /ready returns 200 only when every backing service
 * responds within its individual budget. Liveness (/health) is unaffected.
 *
 * Probes run concurrently; the worst-case latency of /ready is bounded by
 * PROBE_TIMEOUT_MS rather than the sum of all probes.
 */
@Injectable()
export class ReadinessService {
  private readonly logger = new Logger(ReadinessService.name);

  constructor(
    @Inject(DATABASE) private readonly sql: PostgresClient,
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(OPENSEARCH) private readonly os: OpenSearchClient,
  ) {}

  async check(): Promise<ReadinessReport> {
    const [postgres, redis, opensearch] = await Promise.all([
      this.probePostgres(),
      this.probeRedis(),
      this.probeOpenSearch(),
    ]);
    const deps: Record<string, DepStatus> = { postgres, redis, opensearch };
    const ok = Object.values(deps).every((v) => v === 'up');
    return { ok, deps };
  }

  private probePostgres(): Promise<DepStatus> {
    return withBudget(
      'postgres',
      this.logger,
      this.sql`SELECT 1`.then(() => 'up' as const),
    );
  }

  private probeRedis(): Promise<DepStatus> {
    return withBudget('redis', this.logger, this.redis.ping().then(() => 'up' as const));
  }

  private probeOpenSearch(): Promise<DepStatus> {
    return withBudget(
      'opensearch',
      this.logger,
      this.os.cluster
        .health({ wait_for_status: 'yellow', timeout: '1s' })
        .then(() => 'up' as const),
    );
  }
}

function withBudget<T extends DepStatus>(
  name: string,
  logger: Logger,
  promise: Promise<T>,
): Promise<DepStatus> {
  return Promise.race<DepStatus>([
    promise.catch((err: unknown) => {
      logger.warn(
        `readiness probe failed for ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'down';
    }),
    new Promise<DepStatus>((resolve) => setTimeout(() => resolve('down'), PROBE_TIMEOUT_MS)),
  ]);
}
