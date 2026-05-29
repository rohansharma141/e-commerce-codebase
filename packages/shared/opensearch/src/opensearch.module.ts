import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '@platform/shared/config';
import { createOpenSearchClient, type OpenSearchClient } from './client';
import { TenantSearchClient } from './tenant-search-client';
import { OPENSEARCH, TENANT_SEARCH_CLIENT } from './tokens';

@Global()
@Module({
  providers: [
    {
      provide: OPENSEARCH,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): OpenSearchClient =>
        createOpenSearchClient(config.OPENSEARCH_URL),
    },
    {
      provide: TENANT_SEARCH_CLIENT,
      inject: [OPENSEARCH],
      useFactory: (os: OpenSearchClient): TenantSearchClient => new TenantSearchClient(os),
    },
  ],
  exports: [OPENSEARCH, TENANT_SEARCH_CLIENT],
})
export class OpenSearchModule {}
