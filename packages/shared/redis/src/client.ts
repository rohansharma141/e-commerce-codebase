import IORedis, { type Redis } from 'ioredis';

export type RedisClient = Redis;

export function createRedisClient(url: string): RedisClient {
  return new IORedis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
}
