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

export const sharedEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema.default('info'),
  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema,
  API_BASE_URL: z.string().url(),
  TRANSITOUS_BASE_URL: z.string().url(),
});

export const apiEnvSchema = sharedEnvSchema.extend({
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
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
  })
  .superRefine((env, ctx) => {
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

export type WorkerConfig = {
  nodeEnv: WorkerEnv['NODE_ENV'];
  logLevel: WorkerEnv['LOG_LEVEL'];
  databaseUrl: string;
  redisUrl: string;
  apiBaseUrl: string;
  transitousBaseUrl: string;
  outbox: OutboxDispatcherSettings;
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
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    apiBaseUrl: env.API_BASE_URL,
    transitousBaseUrl: env.TRANSITOUS_BASE_URL,
    host: env.API_HOST,
    port: env.API_PORT,
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
