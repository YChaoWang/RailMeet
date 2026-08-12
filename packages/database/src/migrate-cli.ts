import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

import { createDatabase, type DatabaseConfig } from './client.js';

function findEnvFile(startDir: string): string | undefined {
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

/**
 * CLI entry for applying committed migrations.
 * Loads `.env` from the monorepo root when present.
 */
async function main(): Promise<void> {
  const envPath =
    findEnvFile(process.cwd()) ?? findEnvFile(dirname(fileURLToPath(import.meta.url)));
  if (envPath) {
    loadDotenv({ path: envPath });
  }

  const connectionString = process.env['DATABASE_URL_DIRECT'] ?? process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL or DATABASE_URL_DIRECT is required to run migrations');
    process.exit(1);
  }

  const config: DatabaseConfig = { connectionString };
  const database = createDatabase(config);

  try {
    await database.migrate();
    console.info('Migrations applied successfully');
  } finally {
    await database.close();
  }
}

void main();
