import {
  Global,
  Inject,
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';

export interface TenantContextModuleOptions {
  /** Routes that should bypass tenant resolution (e.g. liveness probes). */
  readonly excludeRoutes?: readonly string[];
}

export const TENANT_CONTEXT_OPTIONS = Symbol('TENANT_CONTEXT_OPTIONS');

@Global()
@Module({
  providers: [
    TenantMiddleware,
    { provide: TENANT_CONTEXT_OPTIONS, useValue: {} as TenantContextModuleOptions },
  ],
  exports: [TenantMiddleware],
})
export class TenantContextModule implements NestModule {
  static forRoot(options: TenantContextModuleOptions = {}): DynamicModule {
    return {
      module: TenantContextModule,
      providers: [
        TenantMiddleware,
        { provide: TENANT_CONTEXT_OPTIONS, useValue: options },
      ],
      exports: [TenantMiddleware],
    };
  }

  constructor(
    @Inject(TENANT_CONTEXT_OPTIONS) private readonly options: TenantContextModuleOptions,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    const exclude = this.options.excludeRoutes ?? [];
    const builder = consumer.apply(TenantMiddleware);
    if (exclude.length > 0) {
      builder.exclude(...exclude).forRoutes('*');
    } else {
      builder.forRoutes('*');
    }
  }
}
