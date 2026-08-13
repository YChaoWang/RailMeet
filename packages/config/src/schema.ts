import { z } from 'zod';

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

/**
 * Shared environment fields used by multiple services.
 * Individual loaders pick the subset they need.
 */
const postgresUrlSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
    message: 'Must be a PostgreSQL connection string (postgresql:// or postgres://)',
  });

const redisUrlSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
    message: 'Must be a Redis connection string (redis:// or rediss://)',
  });

/** Defaults chosen so lease duration covers worst-case bounded-batch scheduling. */
export const OUTBOX_DEFAULTS = {
  pollIntervalMs: 1_000,
  batchSize: 10,
  leaseMs: 60_000,
  retryBaseMs: 1_000,
  retryMaxMs: 60_000,
  publishConcurrency: 3,
  redisCommandTimeoutMs: 5_000,
  /** DB mark + scheduling margin per event wave. */
  perEventSafetyMs: 2_000,
} as const;

/** BullMQ consumer + job retention defaults (new jobs only; Phase 5 jobs keep prior options). */
export const SEARCH_JOB_DEFAULTS = {
  consumerConcurrency: 2,
  candidateConsumerConcurrency: 2,
  routingConsumerConcurrency: 2,
  finalizationConsumerConcurrency: 2,
  candidateLimit: 3,
  attempts: 5,
  backoffDelayMs: 2_000,
  /** BullMQ BackoffOptions.jitter fraction (0–1). */
  backoffJitter: 0.2,
  removeOnCompleteAgeSeconds: 3_600,
  removeOnCompleteCount: 1_000,
  removeOnFailAgeSeconds: 86_400,
  removeOnFailCount: 5_000,
  shutdownTimeoutMs: 30_000,
} as const;

export const TRANSITOUS_DEFAULTS = {
  /** Official public MOTIS 2 API root (includes `/api`). */
  baseUrl: 'https://api.transitous.org/api',
  timeoutMs: 10_000,
  maxResponseBytes: 1_048_576,
  userAgent: 'RailMeet/0.0.0 (+https://github.com/example/railmeet)',
} as const;

/**
 * Minimum lease duration so the last event in a claimed batch cannot outlive its lease
 * while this dispatcher is still processing the batch with bounded concurrency.
 *
 * waves = ceil(batchSize / publishConcurrency)
 * lease > waves × (redisCommandTimeout + perEventSafety)
 */
export function minimumOutboxLeaseMs(options: {
  readonly batchSize: number;
  readonly publishConcurrency: number;
  readonly redisCommandTimeoutMs?: number;
  readonly perEventSafetyMs?: number;
}): number {
  const concurrency = Math.max(1, options.publishConcurrency);
  const waves = Math.ceil(Math.max(1, options.batchSize) / concurrency);
  const perEvent =
    (options.redisCommandTimeoutMs ?? OUTBOX_DEFAULTS.redisCommandTimeoutMs) +
    (options.perEventSafetyMs ?? OUTBOX_DEFAULTS.perEventSafetyMs);
  return waves * perEvent;
}

const positiveInt = (min: number, max: number, label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .int({ message: `${label} must be an integer` })
    .min(min, { message: `${label} must be at least ${min}` })
    .max(max, { message: `${label} must be at most ${max}` });

const transitousUserAgentSchema = z
  .string()
  .min(8)
  .max(200)
  .refine((value) => /RailMeet\//i.test(value) && /\+https?:\/\//i.test(value), {
    message:
      'TRANSITOUS_USER_AGENT must identify the app (RailMeet/<version>) and include a contact URL (+https://...)',
  });

export const sharedEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema.default('info'),
  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema,
  API_BASE_URL: z.string().url(),
  TRANSITOUS_BASE_URL: z.string().url().default(TRANSITOUS_DEFAULTS.baseUrl),
});

export const apiEnvSchema = sharedEnvSchema
  .extend({
    API_HOST: z.string().min(1).default('0.0.0.0'),
    /** Explicit API listen port (local dev). */
    API_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    /** PaaS-injected listen port (Northflank/Railway/Fly). Used when API_PORT is unset. */
    PORT: z.coerce.number().int().min(1).max(65535).optional(),
    /** Comma-separated browser origins allowed for CORS (production Vercel + local dev). */
    WEB_ORIGIN: z.string().min(1).optional(),
    TRANSITOUS_USER_AGENT: transitousUserAgentSchema.default(TRANSITOUS_DEFAULTS.userAgent),
    TRANSITOUS_TIMEOUT_MS: positiveInt(500, 60_000, 'TRANSITOUS_TIMEOUT_MS').default(
      TRANSITOUS_DEFAULTS.timeoutMs,
    ),
    TRANSITOUS_MAX_RESPONSE_BYTES: positiveInt(
      4_096,
      10 * 1_048_576,
      'TRANSITOUS_MAX_RESPONSE_BYTES',
    ).default(TRANSITOUS_DEFAULTS.maxResponseBytes),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const [key, value] of [
        ['DATABASE_URL', env.DATABASE_URL],
        ['REDIS_URL', env.REDIS_URL],
        ['API_BASE_URL', env.API_BASE_URL],
        ['TRANSITOUS_BASE_URL', env.TRANSITOUS_BASE_URL],
      ] as const) {
        if (/localhost|127\.0\.0\.1/i.test(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must not point at localhost when NODE_ENV=production`,
          });
        }
      }
    }
  });

export const workerEnvSchema = sharedEnvSchema
  .extend({
    OUTBOX_POLL_INTERVAL_MS: positiveInt(100, 60_000, 'OUTBOX_POLL_INTERVAL_MS').default(
      OUTBOX_DEFAULTS.pollIntervalMs,
    ),
    OUTBOX_BATCH_SIZE: positiveInt(1, 100, 'OUTBOX_BATCH_SIZE').default(OUTBOX_DEFAULTS.batchSize),
    OUTBOX_LEASE_MS: positiveInt(5_000, 300_000, 'OUTBOX_LEASE_MS').default(
      OUTBOX_DEFAULTS.leaseMs,
    ),
    OUTBOX_RETRY_BASE_MS: positiveInt(100, 60_000, 'OUTBOX_RETRY_BASE_MS').default(
      OUTBOX_DEFAULTS.retryBaseMs,
    ),
    OUTBOX_RETRY_MAX_MS: positiveInt(1_000, 3_600_000, 'OUTBOX_RETRY_MAX_MS').default(
      OUTBOX_DEFAULTS.retryMaxMs,
    ),
    OUTBOX_PUBLISH_CONCURRENCY: positiveInt(1, 20, 'OUTBOX_PUBLISH_CONCURRENCY').default(
      OUTBOX_DEFAULTS.publishConcurrency,
    ),
    SEARCH_CONSUMER_CONCURRENCY: positiveInt(1, 20, 'SEARCH_CONSUMER_CONCURRENCY').default(
      SEARCH_JOB_DEFAULTS.consumerConcurrency,
    ),
    SEARCH_CANDIDATE_CONSUMER_CONCURRENCY: positiveInt(
      1,
      20,
      'SEARCH_CANDIDATE_CONSUMER_CONCURRENCY',
    ).default(SEARCH_JOB_DEFAULTS.candidateConsumerConcurrency),
    SEARCH_ROUTING_CONSUMER_CONCURRENCY: positiveInt(
      1,
      20,
      'SEARCH_ROUTING_CONSUMER_CONCURRENCY',
    ).default(SEARCH_JOB_DEFAULTS.routingConsumerConcurrency),
    SEARCH_FINALIZATION_CONSUMER_CONCURRENCY: positiveInt(
      1,
      20,
      'SEARCH_FINALIZATION_CONSUMER_CONCURRENCY',
    ).default(SEARCH_JOB_DEFAULTS.finalizationConsumerConcurrency),
    SEARCH_CANDIDATE_LIMIT: positiveInt(1, 3, 'SEARCH_CANDIDATE_LIMIT').default(
      SEARCH_JOB_DEFAULTS.candidateLimit,
    ),
    SEARCH_JOB_ATTEMPTS: positiveInt(1, 20, 'SEARCH_JOB_ATTEMPTS').default(
      SEARCH_JOB_DEFAULTS.attempts,
    ),
    SEARCH_JOB_BACKOFF_DELAY_MS: positiveInt(100, 60_000, 'SEARCH_JOB_BACKOFF_DELAY_MS').default(
      SEARCH_JOB_DEFAULTS.backoffDelayMs,
    ),
    SEARCH_JOB_BACKOFF_JITTER: z.coerce
      .number({ invalid_type_error: 'SEARCH_JOB_BACKOFF_JITTER must be a number' })
      .min(0, { message: 'SEARCH_JOB_BACKOFF_JITTER must be at least 0' })
      .max(1, { message: 'SEARCH_JOB_BACKOFF_JITTER must be at most 1' })
      .default(SEARCH_JOB_DEFAULTS.backoffJitter),
    SEARCH_JOB_REMOVE_ON_COMPLETE_AGE_SECONDS: positiveInt(
      60,
      30 * 86_400,
      'SEARCH_JOB_REMOVE_ON_COMPLETE_AGE_SECONDS',
    ).default(SEARCH_JOB_DEFAULTS.removeOnCompleteAgeSeconds),
    SEARCH_JOB_REMOVE_ON_COMPLETE_COUNT: positiveInt(
      1,
      100_000,
      'SEARCH_JOB_REMOVE_ON_COMPLETE_COUNT',
    ).default(SEARCH_JOB_DEFAULTS.removeOnCompleteCount),
    SEARCH_JOB_REMOVE_ON_FAIL_AGE_SECONDS: positiveInt(
      60,
      30 * 86_400,
      'SEARCH_JOB_REMOVE_ON_FAIL_AGE_SECONDS',
    ).default(SEARCH_JOB_DEFAULTS.removeOnFailAgeSeconds),
    SEARCH_JOB_REMOVE_ON_FAIL_COUNT: positiveInt(
      1,
      100_000,
      'SEARCH_JOB_REMOVE_ON_FAIL_COUNT',
    ).default(SEARCH_JOB_DEFAULTS.removeOnFailCount),
    WORKER_SHUTDOWN_TIMEOUT_MS: positiveInt(1_000, 300_000, 'WORKER_SHUTDOWN_TIMEOUT_MS').default(
      SEARCH_JOB_DEFAULTS.shutdownTimeoutMs,
    ),
    TRANSITOUS_USER_AGENT: transitousUserAgentSchema.default(TRANSITOUS_DEFAULTS.userAgent),
    TRANSITOUS_TIMEOUT_MS: positiveInt(500, 60_000, 'TRANSITOUS_TIMEOUT_MS').default(
      TRANSITOUS_DEFAULTS.timeoutMs,
    ),
    TRANSITOUS_MAX_RESPONSE_BYTES: positiveInt(
      4_096,
      10 * 1_048_576,
      'TRANSITOUS_MAX_RESPONSE_BYTES',
    ).default(TRANSITOUS_DEFAULTS.maxResponseBytes),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const [key, value] of [
        ['DATABASE_URL', env.DATABASE_URL],
        ['REDIS_URL', env.REDIS_URL],
        ['API_BASE_URL', env.API_BASE_URL],
        ['TRANSITOUS_BASE_URL', env.TRANSITOUS_BASE_URL],
      ] as const) {
        if (/localhost|127\.0\.0\.1/i.test(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must not point at localhost when NODE_ENV=production`,
          });
        }
      }
    }
    const minimumLease = minimumOutboxLeaseMs({
      batchSize: env.OUTBOX_BATCH_SIZE,
      publishConcurrency: env.OUTBOX_PUBLISH_CONCURRENCY,
      redisCommandTimeoutMs: OUTBOX_DEFAULTS.redisCommandTimeoutMs,
      perEventSafetyMs: OUTBOX_DEFAULTS.perEventSafetyMs,
    });
    if (env.OUTBOX_LEASE_MS <= minimumLease) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OUTBOX_LEASE_MS'],
        message: `OUTBOX_LEASE_MS must be greater than ${minimumLease} for batchSize=${env.OUTBOX_BATCH_SIZE} and publishConcurrency=${env.OUTBOX_PUBLISH_CONCURRENCY} (covers worst-case bounded-batch enqueue + mark time)`,
      });
    }
    if (env.OUTBOX_RETRY_MAX_MS < env.OUTBOX_RETRY_BASE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OUTBOX_RETRY_MAX_MS'],
        message: 'OUTBOX_RETRY_MAX_MS must be >= OUTBOX_RETRY_BASE_MS',
      });
    }
    if (env.SEARCH_JOB_REMOVE_ON_FAIL_AGE_SECONDS < env.SEARCH_JOB_REMOVE_ON_COMPLETE_AGE_SECONDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEARCH_JOB_REMOVE_ON_FAIL_AGE_SECONDS'],
        message: 'Failed job retention age must be >= completed job retention age',
      });
    }
    if (env.SEARCH_JOB_REMOVE_ON_FAIL_COUNT < env.SEARCH_JOB_REMOVE_ON_COMPLETE_COUNT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEARCH_JOB_REMOVE_ON_FAIL_COUNT'],
        message: 'Failed job retention count must be >= completed job retention count',
      });
    }
  });

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema.default('info'),
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type SharedEnv = z.output<typeof sharedEnvSchema>;
export type ApiEnv = z.output<typeof apiEnvSchema>;
export type WorkerEnv = z.output<typeof workerEnvSchema>;
export type WebEnv = z.output<typeof webEnvSchema>;

export type ApiConfig = {
  nodeEnv: ApiEnv['NODE_ENV'];
  logLevel: ApiEnv['LOG_LEVEL'];
  databaseUrl: string;
  redisUrl: string;
  apiBaseUrl: string;
  transitousBaseUrl: string;
  host: string;
  port: number;
  webOrigins: readonly string[];
  transitous: {
    baseUrl: string;
    userAgent: string;
    timeoutMs: number;
    maxResponseBytes: number;
  };
};

export type OutboxDispatcherSettings = {
  pollIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  publishConcurrency: number;
  redisCommandTimeoutMs: number;
};

export type SearchJobSettings = {
  consumerConcurrency: number;
  candidateConsumerConcurrency: number;
  routingConsumerConcurrency: number;
  finalizationConsumerConcurrency: number;
  candidateLimit: number;
  attempts: number;
  backoffDelayMs: number;
  backoffJitter: number;
  removeOnCompleteAgeSeconds: number;
  removeOnCompleteCount: number;
  removeOnFailAgeSeconds: number;
  removeOnFailCount: number;
  shutdownTimeoutMs: number;
};

export type TransitousClientSettings = {
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
  maxResponseBytes: number;
};

export type WorkerConfig = {
  nodeEnv: WorkerEnv['NODE_ENV'];
  logLevel: WorkerEnv['LOG_LEVEL'];
  databaseUrl: string;
  redisUrl: string;
  apiBaseUrl: string;
  transitousBaseUrl: string;
  outbox: OutboxDispatcherSettings;
  searchJobs: SearchJobSettings;
  transitous: TransitousClientSettings;
};

export type WebConfig = {
  nodeEnv: WebEnv['NODE_ENV'];
  logLevel: WebEnv['LOG_LEVEL'];
  apiBaseUrl: string;
  port: number;
};

export class ConfigError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

function formatIssues(issues: z.ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

export function parseWithSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  env: NodeJS.ProcessEnv,
  label: string,
): z.output<TSchema> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      `Invalid ${label} configuration: ${formatIssues(result.error.issues)}`,
      result.error.issues,
    );
  }
  return result.data;
}

export function toApiConfig(env: ApiEnv): ApiConfig {
  const webOrigins =
    env.WEB_ORIGIN?.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0) ?? [];
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    apiBaseUrl: env.API_BASE_URL,
    transitousBaseUrl: env.TRANSITOUS_BASE_URL,
    host: env.API_HOST,
    port: env.API_PORT ?? env.PORT ?? 3001,
    webOrigins,
    transitous: {
      baseUrl: env.TRANSITOUS_BASE_URL,
      userAgent: env.TRANSITOUS_USER_AGENT,
      timeoutMs: env.TRANSITOUS_TIMEOUT_MS,
      maxResponseBytes: env.TRANSITOUS_MAX_RESPONSE_BYTES,
    },
  };
}

export function toWorkerConfig(env: WorkerEnv): WorkerConfig {
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    apiBaseUrl: env.API_BASE_URL,
    transitousBaseUrl: env.TRANSITOUS_BASE_URL,
    outbox: {
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      batchSize: env.OUTBOX_BATCH_SIZE,
      leaseMs: env.OUTBOX_LEASE_MS,
      retryBaseMs: env.OUTBOX_RETRY_BASE_MS,
      retryMaxMs: env.OUTBOX_RETRY_MAX_MS,
      publishConcurrency: env.OUTBOX_PUBLISH_CONCURRENCY,
      redisCommandTimeoutMs: OUTBOX_DEFAULTS.redisCommandTimeoutMs,
    },
    searchJobs: {
      consumerConcurrency: env.SEARCH_CONSUMER_CONCURRENCY,
      candidateConsumerConcurrency: env.SEARCH_CANDIDATE_CONSUMER_CONCURRENCY,
      routingConsumerConcurrency: env.SEARCH_ROUTING_CONSUMER_CONCURRENCY,
      finalizationConsumerConcurrency: env.SEARCH_FINALIZATION_CONSUMER_CONCURRENCY,
      candidateLimit: env.SEARCH_CANDIDATE_LIMIT,
      attempts: env.SEARCH_JOB_ATTEMPTS,
      backoffDelayMs: env.SEARCH_JOB_BACKOFF_DELAY_MS,
      backoffJitter: env.SEARCH_JOB_BACKOFF_JITTER,
      removeOnCompleteAgeSeconds: env.SEARCH_JOB_REMOVE_ON_COMPLETE_AGE_SECONDS,
      removeOnCompleteCount: env.SEARCH_JOB_REMOVE_ON_COMPLETE_COUNT,
      removeOnFailAgeSeconds: env.SEARCH_JOB_REMOVE_ON_FAIL_AGE_SECONDS,
      removeOnFailCount: env.SEARCH_JOB_REMOVE_ON_FAIL_COUNT,
      shutdownTimeoutMs: env.WORKER_SHUTDOWN_TIMEOUT_MS,
    },
    transitous: {
      baseUrl: env.TRANSITOUS_BASE_URL,
      userAgent: env.TRANSITOUS_USER_AGENT,
      timeoutMs: env.TRANSITOUS_TIMEOUT_MS,
      maxResponseBytes: env.TRANSITOUS_MAX_RESPONSE_BYTES,
    },
  };
}

export function toWebConfig(env: WebEnv): WebConfig {
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    apiBaseUrl: env.NEXT_PUBLIC_API_BASE_URL,
    port: env.WEB_PORT,
  };
}
