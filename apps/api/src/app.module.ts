import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from '@platform/shared/config';
import { DatabaseModule, TenantBindingMiddleware } from '@platform/shared/database';
import { EventBusModule } from '@platform/shared/event-bus';
import { HooksModule } from '@platform/shared/hooks';
import { ObservabilityModule } from '@platform/shared/observability';
import { OpenSearchModule } from '@platform/shared/opensearch';
import { RedisModule } from '@platform/shared/redis';
import { SecurityModule } from '@platform/shared/security';
import { TenantContextModule, TenantMiddleware } from '@platform/shared/tenant-context';
import { CartModule } from '@platform/modules/cart/src';
import { CatalogModule } from '@platform/modules/catalog/src';
import { OrdersModule } from '@platform/modules/orders/src';
import { PricingModule } from '@platform/modules/pricing/src';
import { SearchModule } from '@platform/modules/search/src';
import { DemoHooksModule } from './demo-hooks.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? 'info',
        // genReqId: pino assigns this id to its per-request bound logger. We
        // accept an inbound x-request-id (so callers can correlate against
        // their own logs) and fall back to a uuid. TenantMiddleware later
        // reads the same header and binds it into ALS so currentTenant()
        // and req.log carry the SAME id end-to-end.
        genReqId: (req, res) => {
          const fromHeader = req.headers['x-request-id'];
          const id =
            (Array.isArray(fromHeader) ? fromHeader[0] : fromHeader) ?? randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        customProps: () => ({}),
      },
    }),
    AppConfigModule,
    DatabaseModule,
    EventBusModule,
    HooksModule,
    OpenSearchModule,
    RedisModule,
    SecurityModule,
    ObservabilityModule,
    TenantContextModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'schema.gql'),
      sortSchema: true,
      playground: false,
    }),
    CatalogModule,
    SearchModule,
    PricingModule,
    CartModule,
    OrdersModule,
    DemoHooksModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  // /health and /ready are both pre-tenant: the former is plain liveness,
  // the latter must be probable from outside (k8s, monitoring) without a
  // tenant context. /docs is the Swagger UI; it must load without a header
  // (you set the header *inside* the UI via Authorize).
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware, TenantBindingMiddleware)
      .exclude('health', 'ready', 'docs', 'docs/(.*)', 'docs-json', 'docs-yaml')
      .forRoutes('*');
  }
}
