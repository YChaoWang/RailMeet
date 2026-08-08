import { describe, expect, it } from 'vitest';

import {
  apiEnvSchema,
  ConfigError,
  OUTBOX_DEFAULTS,
  minimumOutboxLeaseMs,
  parseWithSchema,
  toApiConfig,
  toWebConfig,
  toWorkerConfig,
  webEnvSchema,
  workerEnvSchema,
} from './schema.js';

const validShared = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://railmeet:railmeet@localhost:5432/railmeet',
  REDIS_URL: 'redis://localhost:6379',
  API_BASE_URL: 'http://localhost:3001',
  TRANSITOUS_BASE_URL: 'https://api.transitous.org/api',
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

describe('workerEnvSchema outbox settings', () => {
  it('applies outbox defaults', () => {
    const env = parseWithSchema(workerEnvSchema, { ...validShared }, 'worker');
    const config = toWorkerConfig(env);
    expect(config.outbox).toEqual({
      pollIntervalMs: OUTBOX_DEFAULTS.pollIntervalMs,
      batchSize: OUTBOX_DEFAULTS.batchSize,
      leaseMs: OUTBOX_DEFAULTS.leaseMs,
      retryBaseMs: OUTBOX_DEFAULTS.retryBaseMs,
      retryMaxMs: OUTBOX_DEFAULTS.retryMaxMs,
      publishConcurrency: OUTBOX_DEFAULTS.publishConcurrency,
      redisCommandTimeoutMs: OUTBOX_DEFAULTS.redisCommandTimeoutMs,
    });
    expect(config.searchJobs.consumerConcurrency).toBe(2);
    expect(config.searchJobs.removeOnFailAgeSeconds).toBeGreaterThanOrEqual(
      config.searchJobs.removeOnCompleteAgeSeconds,
    );
    expect(config.transitous.userAgent).toMatch(/RailMeet\//);
  });

  it('accepts overrides within bounds', () => {
    const env = parseWithSchema(
      workerEnvSchema,
      {
        ...validShared,
        OUTBOX_POLL_INTERVAL_MS: '2000',
        OUTBOX_BATCH_SIZE: '5',
        OUTBOX_LEASE_MS: '60000',
        OUTBOX_RETRY_BASE_MS: '500',
        OUTBOX_RETRY_MAX_MS: '10000',
        OUTBOX_PUBLISH_CONCURRENCY: '4',
      },
      'worker',
    );
    expect(toWorkerConfig(env).outbox.batchSize).toBe(5);
    expect(toWorkerConfig(env).outbox.leaseMs).toBe(60_000);
  });

  it('rejects lease duration shorter than worst-case bounded-batch processing', () => {
    expect(() =>
      parseWithSchema(
        workerEnvSchema,
        {
          ...validShared,
          OUTBOX_BATCH_SIZE: '10',
          OUTBOX_PUBLISH_CONCURRENCY: '1',
          OUTBOX_LEASE_MS: '30000',
        },
        'worker',
      ),
    ).toThrow(ConfigError);
  });

  it('rejects unbounded batch sizes', () => {
    expect(() =>
      parseWithSchema(workerEnvSchema, { ...validShared, OUTBOX_BATCH_SIZE: '101' }, 'worker'),
    ).toThrow(ConfigError);
  });

  it('computes minimum lease from batch waves and timeouts', () => {
    expect(
      minimumOutboxLeaseMs({
        batchSize: 10,
        publishConcurrency: 3,
        redisCommandTimeoutMs: 5_000,
        perEventSafetyMs: 2_000,
      }),
    ).toBe(28_000);
  });
});

describe('workerEnvSchema search job retry and retention', () => {
  it('applies search job defaults including backoff jitter and fail>=complete retention', () => {
    const config = toWorkerConfig(parseWithSchema(workerEnvSchema, { ...validShared }, 'worker'));
    expect(config.searchJobs.attempts).toBe(5);
    expect(config.searchJobs.backoffDelayMs).toBe(2_000);
    expect(config.searchJobs.backoffJitter).toBe(0.2);
    expect(config.searchJobs.removeOnFailAgeSeconds).toBeGreaterThanOrEqual(
      config.searchJobs.removeOnCompleteAgeSeconds,
    );
    expect(config.searchJobs.removeOnFailCount).toBeGreaterThanOrEqual(
      config.searchJobs.removeOnCompleteCount,
    );
    expect(config.searchJobs.removeOnCompleteAgeSeconds).toBeGreaterThan(0);
    expect(config.searchJobs.removeOnCompleteCount).toBeGreaterThan(0);
  });

  it('rejects invalid attempts, backoff, jitter, and retention combinations', () => {
    const cases: Array<Record<string, string>> = [
      { SEARCH_JOB_ATTEMPTS: '0' },
      { SEARCH_JOB_ATTEMPTS: '-1' },
      { SEARCH_JOB_ATTEMPTS: '1.5' },
      { SEARCH_JOB_ATTEMPTS: '21' },
      { SEARCH_JOB_BACKOFF_DELAY_MS: '0' },
      { SEARCH_JOB_BACKOFF_DELAY_MS: '-10' },
      { SEARCH_JOB_BACKOFF_JITTER: '-0.1' },
      { SEARCH_JOB_BACKOFF_JITTER: '1.1' },
      { SEARCH_JOB_REMOVE_ON_COMPLETE_AGE_SECONDS: '0' },
      { SEARCH_JOB_REMOVE_ON_COMPLETE_COUNT: '0' },
      { SEARCH_JOB_REMOVE_ON_FAIL_AGE_SECONDS: '0' },
      { SEARCH_JOB_REMOVE_ON_FAIL_COUNT: '0' },
      {
        SEARCH_JOB_REMOVE_ON_COMPLETE_AGE_SECONDS: '3600',
        SEARCH_JOB_REMOVE_ON_FAIL_AGE_SECONDS: '1800',
      },
      {
        SEARCH_JOB_REMOVE_ON_COMPLETE_COUNT: '1000',
        SEARCH_JOB_REMOVE_ON_FAIL_COUNT: '100',
      },
      { SEARCH_JOB_BACKOFF_DELAY_MS: 'Infinity' },
    ];

    for (const override of cases) {
      expect(() =>
        parseWithSchema(workerEnvSchema, { ...validShared, ...override }, 'worker'),
      ).toThrow(ConfigError);
    }
  });

  it('rejects a non-identifying Transitous User-Agent', () => {
    expect(() =>
      parseWithSchema(
        workerEnvSchema,
        { ...validShared, TRANSITOUS_USER_AGENT: 'curl/8.0' },
        'worker',
      ),
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
