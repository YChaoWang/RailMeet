import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from './client.js';

const POSTGIS_IMAGE = 'ghcr.io/baosystems/postgis:16-3.5';

async function seedPlaces(database: Database): Promise<void> {
  for (const place of [
    {
      id: 'place:berlin',
      name: 'Berlin',
      kind: 'city' as const,
      countryCode: 'DE',
      timezone: 'Europe/Berlin',
      location: { longitude: 13.405, latitude: 52.52 },
    },
    {
      id: 'place:paris',
      name: 'Paris',
      kind: 'city' as const,
      countryCode: 'FR',
      timezone: 'Europe/Paris',
      location: { longitude: 2.3522, latitude: 48.8566 },
    },
  ]) {
    if (!(await database.places.findById(place.id))) {
      await database.places.create(place);
    }
  }
}

async function createQueuedSearch(database: Database) {
  const result = await database.meetingSearches.create({
    participants: [
      {
        participantId: 'a',
        displayName: 'A',
        originPlaceId: 'place:berlin',
        position: 0,
      },
      {
        participantId: 'b',
        displayName: 'B',
        originPlaceId: 'place:paris',
        position: 1,
      },
    ],
    travelDate: '2026-06-15',
    earliestDepartureTime: '08:00',
    latestArrivalTime: '22:00',
    arrivalDayOffset: 0,
    maxJourneyDurationMinutes: 400,
    maxTransfers: 1,
    minTransferDurationMinutes: 5,
    allowedTransportModes: ['train'],
    rankingMode: 'fairest',
  });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('create failed');
  }
  return result.value;
}

describe('meeting-search kickoff', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_kickoff')
      .withUsername('railmeet')
      .withPassword('railmeet')
      .start();
    database = createDatabase({
      connectionString: container.getConnectionUri(),
      maxConnections: 8,
    });
    await database.migrate();
    await seedPlaces(database);
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 60_000);

  it('transitions queued to running and records started_at once', async () => {
    const search = await createQueuedSearch(database);
    expect(search.status).toBe('queued');
    expect(search.startedAt).toBeNull();

    const first = await database.meetingSearches.tryKickoff(search.id);
    expect(first.outcome).toBe('started');
    if (first.outcome !== 'started') {
      return;
    }
    expect(first.startedAt).toBeInstanceOf(Date);

    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('running');
    expect(loaded?.startedAt?.getTime()).toBe(first.startedAt.getTime());

    const generation = await database.searchPipeline.findCandidateGeneration(search.id);
    expect(generation?.status).toBe('pending');
    const outbox = await database.outbox.findByAggregateId(search.id);
    expect(outbox.map((event) => event.eventType).sort()).toEqual([
      'meeting-search.candidates-requested',
      'meeting-search.requested',
    ]);

    const second = await database.meetingSearches.tryKickoff(search.id);
    expect(second.outcome).toBe('already_started');
    if (second.outcome !== 'already_started') {
      return;
    }
    expect(second.startedAt?.getTime()).toBe(first.startedAt.getTime());
    const again = await database.meetingSearches.findById(search.id);
    expect(again?.startedAt?.getTime()).toBe(first.startedAt.getTime());
    expect((await database.outbox.findByAggregateId(search.id)).length).toBe(2);
  });

  it('does not reopen completed or failed searches', async () => {
    const completed = await createQueuedSearch(database);
    await database.meetingSearches.tryKickoff(completed.id);
    await database.db.execute(sql`
      UPDATE meeting_searches SET status = 'completed' WHERE id = ${completed.id}
    `);
    const completedKickoff = await database.meetingSearches.tryKickoff(completed.id);
    expect(completedKickoff.outcome).toBe('already_terminal');
    expect((await database.meetingSearches.findById(completed.id))?.status).toBe('completed');

    const failed = await createQueuedSearch(database);
    await database.db.execute(sql`
      UPDATE meeting_searches SET status = 'failed' WHERE id = ${failed.id}
    `);
    const failedKickoff = await database.meetingSearches.tryKickoff(failed.id);
    expect(failedKickoff.outcome).toBe('already_terminal');
    expect((await database.meetingSearches.findById(failed.id))?.status).toBe('failed');
  });

  it('classifies missing searches as not_found', async () => {
    const result = await database.meetingSearches.tryKickoff(
      '99999999-9999-4999-8999-999999999999',
    );
    expect(result).toEqual({
      outcome: 'not_found',
      searchId: '99999999-9999-4999-8999-999999999999',
    });
  });

  it('allows only one concurrent transition to running', async () => {
    const search = await createQueuedSearch(database);
    const [a, b] = await Promise.all([
      database.meetingSearches.tryKickoff(search.id),
      database.meetingSearches.tryKickoff(search.id),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['already_started', 'started']);
    const loaded = await database.meetingSearches.findById(search.id);
    expect(loaded?.status).toBe('running');
    expect(loaded?.startedAt).not.toBeNull();
  });

  it('does not let a stale updateStatusIf overwrite a newer status', async () => {
    const search = await createQueuedSearch(database);
    await database.meetingSearches.tryKickoff(search.id);
    const stale = await database.meetingSearches.updateStatusIf(search.id, ['queued'], 'running');
    expect(stale.outcome).toBe('conflict');
    if (stale.outcome === 'conflict') {
      expect(stale.currentStatus).toBe('running');
    }
  });
});
