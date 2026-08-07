import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  apiEnvSchema,
  type ApiConfig,
  parseWithSchema,
  toApiConfig,
  toWebConfig,
  toWorkerConfig,
  type WebConfig,
  webEnvSchema,
  type WorkerConfig,
  workerEnvSchema,
} from './schema.js';

export type { ApiConfig, WebConfig, WorkerConfig } from './schema.js';
export {
  apiEnvSchema,
  ConfigError,
  parseWithSchema,
  sharedEnvSchema,
  toApiConfig,
  toWebConfig,
  toWorkerConfig,
  webEnvSchema,
  workerEnvSchema,
} from './schema.js';

export type LoadEnvOptions = {
  /** Absolute or relative path to a .env file. When omitted, walks up from cwd. */
  envFilePath?: string;
  /** When false, skip dotenv loading (useful in tests). Defaults to true. */
  loadDotenv?: boolean;
  /** Starting directory for upward `.env` search. Defaults to `process.cwd()`. */
  searchFrom?: string;
};

/**
 * Walks from `startDir` toward the filesystem root looking for a `.env` file.
 * Supports monorepo apps whose cwd is `apps/api` while `.env` lives at the repo root.
 */
export function findEnvFile(startDir: string = process.cwd()): string | undefined {
  let current = resolve(startDir);

  for (;;) {
    const candidate = join(current, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function applyDotenv(options: LoadEnvOptions | undefined): void {
  if (options?.loadDotenv === false) {
    return;
  }

  const path = options?.envFilePath
    ? resolve(options.envFilePath)
    : findEnvFile(options?.searchFrom ?? process.cwd());

  if (path) {
    loadDotenv({ path });
    return;
  }

  loadDotenv();
}

export function loadApiConfig(options?: LoadEnvOptions): ApiConfig {
  applyDotenv(options);
  const env = parseWithSchema(apiEnvSchema, process.env, 'API');
  return toApiConfig(env);
}

export function loadWorkerConfig(options?: LoadEnvOptions): WorkerConfig {
  applyDotenv(options);
  const env = parseWithSchema(workerEnvSchema, process.env, 'worker');
  return toWorkerConfig(env);
}

export function loadWebConfig(options?: LoadEnvOptions): WebConfig {
  applyDotenv(options);
  const env = parseWithSchema(webEnvSchema, process.env, 'web');
  return toWebConfig(env);
}
