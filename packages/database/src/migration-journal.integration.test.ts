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

describe('migration journal on fresh PostGIS', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_migration_journal')
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

  it('applies the complete migration journal through 0012 to a fresh PostGIS database', async () => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal;
    expect(journal.entries.map((entry) => entry.tag)).toContain('0007_eager_lyja');
    expect(journal.entries.map((entry) => entry.tag)).toContain(
      '0011_catalog_ownership_namespaces',
    );
    expect(journal.entries.map((entry) => entry.tag)).toContain(
      '0012_meeting_city_eligibility_fields',
    );
    expect(journal.entries.at(-1)?.tag).toBe('0012_meeting_city_eligibility_fields');
    expect(journal.entries).toHaveLength(13);

    const before = await database.db.execute(sql`
      SELECT to_regclass('public.meeting_search_candidate_evaluations') AS evaluations_table
    `);
    expect(before[0]?.['evaluations_table']).toBeNull();

    await database.migrate();

    const applied = await database.db.execute(sql`
      SELECT created_at
      FROM "drizzle"."__drizzle_migrations"
      ORDER BY created_at ASC
    `);
    expect(applied).toHaveLength(13);
    expect(applied.map((row) => Number(row['created_at']))).toEqual(
      journal.entries.map((entry) => entry.when),
    );
    expect(Number(applied.at(-1)?.['created_at'])).toBe(
      journal.entries.find((entry) => entry.tag === '0012_meeting_city_eligibility_fields')?.when,
    );

    const tables = await database.db.execute(sql`
      SELECT
        to_regclass('public.meeting_search_candidate_evaluations') AS evaluations_table,
        to_regclass('public.meeting_search_candidate_rankings') AS rankings_table,
        to_regclass('public.meeting_search_candidate_ranking_journeys') AS ranking_journeys_table,
        to_regclass('public.meeting_city_hubs') AS hubs_table,
        to_regclass('public.catalog_import_runs') AS catalog_runs_table
    `);
    expect(tables[0]?.['evaluations_table']).toBe('meeting_search_candidate_evaluations');
    expect(tables[0]?.['rankings_table']).toBe('meeting_search_candidate_rankings');
    expect(tables[0]?.['ranking_journeys_table']).toBe('meeting_search_candidate_ranking_journeys');
    expect(tables[0]?.['hubs_table']).toBe('meeting_city_hubs');
    expect(tables[0]?.['catalog_runs_table']).toBe('catalog_import_runs');

    const placeProviderColumns = await database.db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'places'
        AND column_name IN (
          'provider',
          'provider_place_id',
          'ownership',
          'active',
          'population',
          'feature_code'
        )
      ORDER BY column_name
    `);
    expect(placeProviderColumns.map((row) => row['column_name'])).toEqual([
      'active',
      'feature_code',
      'ownership',
      'population',
      'provider',
      'provider_place_id',
    ]);

    const providerIndex = await database.db.execute(sql`
      SELECT 1 AS ok
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'places'
        AND indexname = 'places_provider_place_uid'
    `);
    expect(providerIndex).toHaveLength(1);

    expect(container.getMappedPort(5432)).toBeGreaterThan(0);
    expect(container.getConnectionUri()).toContain(`:${container.getMappedPort(5432)}`);
  });
});
