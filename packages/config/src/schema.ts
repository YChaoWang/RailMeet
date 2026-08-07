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

export const workerEnvSchema = sharedEnvSchema;

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

export type WorkerConfig = {
  nodeEnv: WorkerEnv['NODE_ENV'];
  logLevel: WorkerEnv['LOG_LEVEL'];
  databaseUrl: string;
  redisUrl: string;
  apiBaseUrl: string;
  transitousBaseUrl: string;
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
