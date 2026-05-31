import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '@platform/shared/config';
import { createRedisClient, type RedisClient } from './client';
import { TenantRedisClient } from './tenant-redis';
import { REDIS, TENANT_REDIS } from './tokens';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): RedisClient => createRedisClient(config.REDIS_URL),
    },
    {
      provide: TENANT_REDIS,
      inject: [REDIS],
      useFactory: (client: RedisClient): TenantRedisClient => new TenantRedisClient(client),
    },
  ],
  exports: [REDIS, TENANT_REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly client: RedisClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
