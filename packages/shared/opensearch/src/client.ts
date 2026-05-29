import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

export type { OpenSearchClient };

export function createOpenSearchClient(url: string): OpenSearchClient {
  return new OpenSearchClient({
    node: url,
    // Dev opensearch in docker-compose runs with DISABLE_SECURITY_PLUGIN=true,
    // so no auth. Production would carry credentials via env.
    ssl: { rejectUnauthorized: false },
    requestTimeout: 30_000,
  });
}
