# shared/config

Environment validation. The api crashes at boot if any required env var is missing or malformed.

## Public surface

- `loadEnv()` → `Env` — parses `process.env` against a Zod schema
- `APP_CONFIG` token + `AppConfig` type
- `AppConfigModule` — Nest `@Global` module that resolves config once at boot

## Internals

- `env.schema.ts` — the Zod schema; validates `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `REDIS_URL`, `OPENSEARCH_URL`
- `app-config.ts` — the DI token + `InjectAppConfig()` helper
- `config.module.ts` — wraps `@nestjs/config`

## Tests

- `env.schema.spec.ts` — parses valid env, applies defaults, throws on malformed or missing required fields
