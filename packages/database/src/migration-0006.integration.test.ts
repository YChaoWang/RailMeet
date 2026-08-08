import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from './client.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const journalPath = join(packageRoot, 'migrations', 'meta', '_journal.json');

type MigrationJournal = {
  readonly entries: ReadonlyArray<{
    readonly idx: number;
    readonly tag: string;
    readonly when: number;
  }>;
};

describe('Phase 8 migration journal on fresh PostGIS', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_migration_0006')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();

    database = createDatabase({
      connectionString: container.getConnectionUri(),
      maxConnections: 5,
    });
  }, 180_000);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (container) {
      await container.stop();
    }
  }, 60_000);

  it('applies the complete migration journal through 0006 to a fresh PostGIS database', async () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal;
    expect(journal.entries.map((entry) => entry.tag)).toContain('0006_petite_flatman');
    expect(journal.entries.at(-1)?.tag).toBe('0006_petite_flatman');
    expect(journal.entries).toHaveLength(7);

    // Pristine container: no RailMeet Phase 8 tables before the real migrator runs.
    const before = await database.db.execute(sql`
      SELECT to_regclass('public.meeting_search_candidate_evaluations') AS evaluations_table
    `);
    expect(before[0]?.['evaluations_table']).toBeNull();

    await database.migrate();

    // Drizzle records applied migrations in schema "drizzle" (not public).
    const applied = await database.db.execute(sql`
      SELECT created_at
      FROM "drizzle"."__drizzle_migrations"
      ORDER BY created_at ASC
    `);
    expect(applied).toHaveLength(7);
    expect(applied.map((row) => Number(row['created_at']))).toEqual(
      journal.entries.map((entry) => entry.when),
    );
    expect(Number(applied.at(-1)?.['created_at'])).toBe(
      journal.entries.find((entry) => entry.tag === '0006_petite_flatman')?.when,
    );

    const tables = await database.db.execute(sql`
      SELECT
        to_regclass('public.meeting_search_candidate_evaluations') AS evaluations_table,
        to_regclass('public.meeting_search_candidate_rankings') AS rankings_table,
        to_regclass('public.meeting_search_candidate_ranking_journeys') AS ranking_journeys_table
    `);
    expect(tables[0]?.['evaluations_table']).toBe('meeting_search_candidate_evaluations');
    expect(tables[0]?.['rankings_table']).toBe('meeting_search_candidate_rankings');
    expect(tables[0]?.['ranking_journeys_table']).toBe('meeting_search_candidate_ranking_journeys');

    const columns = await database.db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'meeting_searches'
        AND column_name IN (
          'completed_at',
          'failed_at',
          'completion_outcome',
          'failure_code',
          'recommended_destination_place_id'
        )
      ORDER BY column_name
    `);
    expect(columns.map((row) => row['column_name'])).toEqual([
      'completed_at',
      'completion_outcome',
      'failed_at',
      'failure_code',
      'recommended_destination_place_id',
    ]);

    const feasibilityCheck = await database.db.execute(sql`
      SELECT 1 AS ok
      FROM pg_constraint
      WHERE conname = 'meeting_search_candidate_evaluations_feasibility_chk'
    `);
    expect(feasibilityCheck).toHaveLength(1);

    // Mapped host port (not a fixed published port).
    expect(container.getMappedPort(5432)).toBeGreaterThan(0);
    expect(container.getConnectionUri()).toContain(`:${container.getMappedPort(5432)}`);
  });
});
