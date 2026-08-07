import { describe, expect, it } from 'vitest';

import {
  apiEnvSchema,
  ConfigError,
  parseWithSchema,
  toApiConfig,
  toWebConfig,
  webEnvSchema,
} from './schema.js';

const validShared = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://railmeet:railmeet@localhost:5432/railmeet',
  REDIS_URL: 'redis://localhost:6379',
  API_BASE_URL: 'http://localhost:3001',
  TRANSITOUS_BASE_URL: 'https://api.transitous.org',
} as const;

describe('apiEnvSchema', () => {
  it('parses a valid API environment and applies defaults', () => {
    const env = parseWithSchema(apiEnvSchema, { ...validShared }, 'API');
    const config = toApiConfig(env);

    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(3001);
    expect(config.logLevel).toBe('info');
    expect(config.databaseUrl).toContain('postgresql://');
  });

  it('coerces API_PORT from a string', () => {
    const env = parseWithSchema(apiEnvSchema, { ...validShared, API_PORT: '4000' }, 'API');
    expect(toApiConfig(env).port).toBe(4000);
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _removed, ...rest } = validShared;
    expect(() => parseWithSchema(apiEnvSchema, rest, 'API')).toThrow(ConfigError);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() =>
      parseWithSchema(apiEnvSchema, { ...validShared, LOG_LEVEL: 'verbose' }, 'API'),
    ).toThrow(ConfigError);
  });
});

describe('webEnvSchema', () => {
  it('parses a valid web environment', () => {
    const env = parseWithSchema(
      webEnvSchema,
      {
        NODE_ENV: 'development',
        NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001',
      },
      'web',
    );
    const config = toWebConfig(env);
    expect(config.apiBaseUrl).toBe('http://localhost:3001');
    expect(config.port).toBe(3000);
  });
});
