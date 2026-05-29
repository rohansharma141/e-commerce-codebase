import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '@platform/shared/config';
import { DatabaseModule, TenantBindingMiddleware } from '@platform/shared/database';
import { EventBusModule } from '@platform/shared/event-bus';
import { TenantContextModule, TenantMiddleware } from '@platform/shared/tenant-context';
import { CatalogModule } from '@platform/modules/catalog/src';
import { HealthController } from './health.controller';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? 'info',
      },
    }),
    AppConfigModule,
    DatabaseModule,
    EventBusModule,
    TenantContextModule,
    CatalogModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  // Ordering matters: TenantMiddleware sets the tenant ALS scope, then
  // TenantBindingMiddleware reads it and reserves a tenant-bound Postgres
  // connection. Both skip /health (liveness probe is intentionally untenanted).
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware, TenantBindingMiddleware)
      .exclude('health')
      .forRoutes('*');
  }
}