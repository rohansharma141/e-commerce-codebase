import postgres, { type Sql } from 'postgres';

export type PostgresClient = Sql;

export function createPostgresClient(databaseUrl: string): PostgresClient {
  return postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connection: { application_name: 'platform-api' },
  });
}
