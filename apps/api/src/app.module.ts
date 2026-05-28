import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '@platform/shared/config';
import { DatabaseModule } from '@platform/shared/database';
import { EventBusModule } from '@platform/shared/event-bus';
import { TenantContextModule } from '@platform/shared/tenant-context';
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
    TenantContextModule.forRoot({ excludeRoutes: ['health'] }),
    CatalogModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
