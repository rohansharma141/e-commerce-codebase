import type { RedisClient } from './client';

/**
 * Handle to one tenant's Redis namespace. Every key is automatically prefixed
 * with `t:{tenantId}:` so cross-tenant key access is impossible by
 * construction — same physical-isolation pattern as the catalog's TENANT_DRIZZLE
 * and search's TenantSearchClient.
 *
 * Note: Redis isn't transactional across keys the way Postgres is, and this
 * wrapper deliberately does not paper over that. Callers that need atomicity
 * across multiple keys must use Redis transactions / Lua scripts directly via
 * the underlying client; the cart's read-modify-write is single-key JSON so
 * this constraint doesn't bite for step 5.
 */
export class TenantRedis {
  constructor(
    private readonly client: RedisClient,
    private readonly prefix: string,
  ) {}

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get(k: string): Promise<string | null> {
    return this.client.get(this.key(k));
  }

  async set(k: string, value: string, ttlSec?: number): Promise<void> {
    if (typeof ttlSec === 'number' && ttlSec > 0) {
      await this.client.set(this.key(k), value, 'EX', ttlSec);
    } else {
      await this.client.set(this.key(k), value);
    }
  }

  async del(k: string): Promise<number> {
    return this.client.del(this.key(k));
  }

  async exists(k: string): Promise<boolean> {
    return (await this.client.exists(this.key(k))) > 0;
  }
}

export class TenantRedisClient {
  constructor(private readonly client: RedisClient) {}

  forTenant(tenantId: string): TenantRedis {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('TenantRedisClient.forTenant: tenantId must be a non-empty string');
    }
    // Allow Redis-safe characters; reject anything that could break the namespace.
    if (!/^[a-zA-Z0-9._-]+$/.test(tenantId)) {
      throw new Error(`TenantRedisClient.forTenant: unsafe tenantId "${tenantId}"`);
    }
    return new TenantRedis(this.client, `t:${tenantId}:`);
  }
}
