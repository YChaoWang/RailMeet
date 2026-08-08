import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema/index.js';
import {
  createMeetingSearchRepository,
  type MeetingSearchRepository,
} from './repositories/meeting-search-repository.js';
import { createOutboxRepository, type OutboxRepository } from './repositories/outbox-repository.js';
import { createPlaceRepository, type PlaceRepository } from './repositories/place-repository.js';
import {
  createFinalizationRepository,
  type FinalizationRepository,
} from './repositories/finalization-repository.js';
import {
  createSearchPipelineRepository,
  type SearchPipelineRepository,
} from './repositories/search-pipeline-repository.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export type DatabaseConfig = {
  readonly connectionString: string;
  /** Optional override for migrations folder (absolute or relative). */
  readonly migrationsFolder?: string;
  /** postgres.js max connections. Defaults to 10. */
  readonly maxConnections?: number;
};

export type Database = {
  readonly db: PostgresJsDatabase<typeof schema>;
  readonly places: PlaceRepository;
  readonly meetingSearches: MeetingSearchRepository;
  readonly outbox: OutboxRepository;
  readonly searchPipeline: SearchPipelineRepository;
  readonly finalization: FinalizationRepository;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
};

export function createDatabase(config: DatabaseConfig): Database {
  let sqlClient: Sql | undefined = postgres(config.connectionString, {
    max: config.maxConnections ?? 10,
    // Avoid logging connection strings; postgres.js does not log them by default.
    onnotice: () => undefined,
  });
  let closed = false;

  const db = drizzle(sqlClient, { schema });

  const places = createPlaceRepository(db);
  const meetingSearches = createMeetingSearchRepository(db);
  const outbox = createOutboxRepository(db);
  const searchPipeline = createSearchPipelineRepository(db);
  const finalization = createFinalizationRepository(db);

  return {
    db,
    places,
    meetingSearches,
    outbox,
    searchPipeline,
    finalization,
    async migrate() {
      const folder = config.migrationsFolder ?? join(packageRoot, 'migrations');
      await migrate(db, { migrationsFolder: folder });
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      const client = sqlClient;
      sqlClient = undefined;
      if (client) {
        await client.end({ timeout: 5 });
      }
    },
  };
}

export type { PostgresJsDatabase };
