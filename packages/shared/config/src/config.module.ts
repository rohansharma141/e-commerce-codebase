import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './app-config';
import { loadEnv } from './env.schema';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadEnv(),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
