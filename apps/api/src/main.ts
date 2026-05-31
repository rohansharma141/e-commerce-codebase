import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '@platform/shared/config';
import { helmetMiddleware } from '@platform/shared/security';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  // helmet sets the bog-standard security headers (HSTS, X-Content-Type-Options,
  // X-Frame-Options, Referrer-Policy, etc.). CSP is intentionally off because
  // GraphQL's landing page at /graphql injects inline scripts; a stricter CSP
  // would land alongside the production gateway. See packages/shared/security.
  app.use(helmetMiddleware());
  // whitelist:false is required so GraphQL @Args inputs (validated by the
  // GraphQL schema, not class-validator decorators) aren't silently stripped
  // to {}. Catalog REST DTOs don't depend on strict whitelisting today; when
  // they do, the pipe should be applied per-controller instead of globally.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: false, transform: true }),
  );
  app.enableShutdownHooks();

  // Swagger UI at /docs — the OpenAPI JSON is at /docs-json. The "Authorize"
  // button collects x-tenant-id once and threads it through every "Try it
  // out" call. Excluded from TenantMiddleware in AppModule so the UI loads
  // without a header. GraphQL is documented separately (its schema is at
  // /graphql); Swagger covers the REST surface.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('e-commerce-codebase')
    .setDescription(
      'Multi-tenant headless commerce platform — REST surface. ' +
        'All tenant-scoped endpoints require the `x-tenant-id` header — click ' +
        '**Authorize** above and set it once (try `t-fashion`, `t-electronics`, or `t-books`). ' +
        'GraphQL hero search lives at /graphql.',
    )
    .setVersion('0.1.0')
    .addApiKey(
      { type: 'apiKey', name: 'x-tenant-id', in: 'header' },
      'tenantHeader',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Apply the tenantHeader security globally so every operation shows the
  // Authorize lock without per-route decorators. /health and /ready ignore it.
  document.security = [{ tenantHeader: [] }];
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.PORT);

  // eslint-disable-next-line no-console
  console.log(`api listening on http://localhost:${config.PORT}`);
  // eslint-disable-next-line no-console
  console.log(`swagger ui at http://localhost:${config.PORT}/docs`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal during bootstrap:', err);
  process.exit(1);
});
