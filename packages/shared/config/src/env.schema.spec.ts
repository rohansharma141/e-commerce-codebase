import { loadEnv } from './env.schema';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  OPENSEARCH_URL: 'http://localhost:9200',
} as NodeJS.ProcessEnv;

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('test');
  });

  it('applies defaults when optional vars are missing', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      OPENSEARCH_URL: 'http://localhost:9200',
    } as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('throws a readable error when required vars are missing', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('throws when a URL field is malformed', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        DATABASE_URL: 'not-a-url',
      } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });
});
