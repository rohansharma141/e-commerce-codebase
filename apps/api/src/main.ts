import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.PORT);

  // eslint-disable-next-line no-console
  console.log(`api listening on http://localhost:${config.PORT}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal during bootstrap:', err);
  process.exit(1);
});
