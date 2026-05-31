import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { join } from 'node:path';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '@platform/shared/config';
import { DatabaseModule, TenantBindingMiddleware } from '@platform/shared/database';
import { EventBusModule } from '@platform/shared/event-bus';
import { OpenSearchModule } from '@platform/shared/opensearch';
import { RedisModule } from '@platform/shared/redis';
import { TenantContextModule, TenantMiddleware } from '@platform/shared/tenant-context';
import { CartModule } from '@platform/modules/cart/src';
import { CatalogModule } from '@platform/modules/catalog/src';
import { OrdersModule } from '@platform/modules/orders/src';
import { PricingModule } from '@platform/modules/pricing/src';
import { SearchModule } from '@platform/modules/search/src';
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
    OpenSearchModule,
    RedisModule,
    TenantContextModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'schema.gql'),
      sortSchema: true,
      playground: false,
      // GraphiQL UI is fine in dev; the playground flag toggles the older one.
      // Apollo's landing page handles introspection in the browser.
    }),
    CatalogModule,
    SearchModule,
    PricingModule,
    CartModule,
    OrdersModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware, TenantBindingMiddleware)
      .exclude('health')
      .forRoutes('*');
  }
}
