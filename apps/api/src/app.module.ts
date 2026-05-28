import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '@platform/shared/config';
import { EventBusModule } from '@platform/shared/event-bus';
import { TenantContextModule } from '@platform/shared/tenant-context';
import { HealthController } from './health.controller';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? 'info',
        transport:
          process.env['NODE_ENV'] === 'development' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    AppConfigModule,
    EventBusModule,
    TenantContextModule.forRoot({ excludeRoutes: ['health'] }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
