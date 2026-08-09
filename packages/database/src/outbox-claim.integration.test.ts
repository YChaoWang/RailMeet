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
    const existing = await database.places.findById(place.id);
    if (!existing) {
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
        origin: { kind: 'existing', placeId: 'place:berlin' },
        position: 0,
      },
      {
        participantId: 'b',
        displayName: 'B',
        origin: { kind: 'existing', placeId: 'place:paris' },
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

describe('outbox claim leasing', () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE)
      .withDatabase('railmeet_outbox')
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

  it('claims due unpublished events and refuses published or dead-lettered rows', async () => {
    const search = await createQueuedSearch(database);
    const events = await database.outbox.findByAggregateId(search.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.publishedAt).toBeNull();

    const claimed = await database.outbox.claimDue({
      batchSize: 10,
      leaseMs: 30_000,
      leaseToken: '11111111-1111-4111-8111-111111111111',
    });
    expect(claimed.map((e) => e.id)).toContain(events[0]!.id);
    expect(claimed[0]?.leaseToken).toBe('11111111-1111-4111-8111-111111111111');

    const blocked = await database.outbox.claimDue({
      batchSize: 10,
      leaseMs: 30_000,
      leaseToken: '22222222-2222-4222-8222-222222222222',
    });
    expect(blocked.map((e) => e.id)).not.toContain(events[0]!.id);

    await database.outbox.markPublished({
      eventId: events[0]!.id,
      leaseToken: '11111111-1111-4111-8111-111111111111',
    });
    const afterPublish = await database.outbox.claimDue({
      batchSize: 10,
      leaseMs: 30_000,
      leaseToken: '33333333-3333-4333-8333-333333333333',
    });
    expect(afterPublish.map((e) => e.id)).not.toContain(events[0]!.id);
  });

  it('reclaims expired leases and enforces batch size with deterministic order', async () => {
    const createdIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const search = await createQueuedSearch(database);
      const [event] = await database.outbox.findByAggregateId(search.id);
      createdIds.push(event!.id);
    }

    // Expire any active leases from prior tests.
    await database.db.execute(sql`
      UPDATE outbox_events
      SET leased_until = now() - interval '1 second'
      WHERE published_at IS NULL AND lease_token IS NOT NULL
    `);

    const first = await database.outbox.claimDue({
      batchSize: 2,
      leaseMs: 30_000,
      leaseToken: '44444444-4444-4444-8444-444444444444',
    });
    expect(first).toHaveLength(2);
    expect(first[0]!.createdAt.getTime()).toBeLessThanOrEqual(first[1]!.createdAt.getTime());
    if (first[0]!.createdAt.getTime() === first[1]!.createdAt.getTime()) {
      expect(first[0]!.id < first[1]!.id).toBe(true);
    }

    await database.db.execute(sql`
      UPDATE outbox_events
      SET leased_until = now() - interval '1 second'
      WHERE lease_token = '44444444-4444-4444-8444-444444444444'::uuid
    `);

    const reclaimed = await database.outbox.claimDue({
      batchSize: 10,
      leaseMs: 30_000,
      leaseToken: '55555555-5555-4555-8555-555555555555',
    });
    expect(reclaimed.map((e) => e.id)).toEqual(expect.arrayContaining(first.map((e) => e.id)));
  });

  it('requires matching lease tokens for publish/retry/dead-letter and blocks stale owners', async () => {
    const search = await createQueuedSearch(database);
    const [event] = await database.outbox.findByAggregateId(search.id);
    await database.db.execute(sql`
      UPDATE outbox_events
      SET lease_token = NULL, leased_until = NULL
      WHERE id = ${event!.id}
    `);
    const ownerToken = '66666666-6666-4666-8666-666666666666';
    const owned = await database.outbox.claimDue({
      batchSize: 50,
      leaseMs: 60_000,
      leaseToken: ownerToken,
    });
    expect(owned.some((e) => e.id === event!.id)).toBe(true);

    const staleToken = '99999999-9999-4999-8999-999999999999';
    expect(
      (
        await database.outbox.markPublished({
          eventId: event!.id,
          leaseToken: staleToken,
        })
      ).outcome,
    ).toBe('not_updated');
    expect(
      (
        await database.outbox.markRetry({
          eventId: event!.id,
          leaseToken: staleToken,
          errorCode: 'REDIS_UNAVAILABLE',
          nextAttemptDelayMs: 5_000,
        })
      ).outcome,
    ).toBe('not_updated');
    expect(
      (
        await database.outbox.markDeadLettered({
          eventId: event!.id,
          leaseToken: staleToken,
          errorCode: 'INVALID_PAYLOAD',
        })
      ).outcome,
    ).toBe('not_updated');

    const stillOwned = await database.outbox.findById(event!.id);
    expect(stillOwned?.leaseToken).toBe(ownerToken);
    expect(stillOwned?.publishedAt).toBeNull();
    expect(stillOwned?.deadLetteredAt).toBeNull();

    const retry = await database.outbox.markRetry({
      eventId: event!.id,
      leaseToken: ownerToken,
      errorCode: 'REDIS_UNAVAILABLE',
      nextAttemptDelayMs: 5_000,
    });
    expect(retry.outcome).toBe('updated');
    const afterRetry = await database.outbox.findById(event!.id);
    expect(afterRetry?.failureCount).toBeGreaterThan(0);
    expect(afterRetry?.leaseToken).toBeNull();
    expect(afterRetry?.leasedUntil).toBeNull();
    expect(afterRetry?.nextAttemptAt).not.toBeNull();
    expect(afterRetry?.publishedAt).toBeNull();
  });

  it('clears lease fields on publish and rejects stale overwrite of a newer lease', async () => {
    const search = await createQueuedSearch(database);
    const [event] = await database.outbox.findByAggregateId(search.id);
    await database.db.execute(sql`
      UPDATE outbox_events SET lease_token = NULL, leased_until = NULL WHERE id = ${event!.id}
    `);
    const firstToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondToken = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await database.outbox.claimDue({
      batchSize: 50,
      leaseMs: 60_000,
      leaseToken: firstToken,
    });
    await database.db.execute(sql`
      UPDATE outbox_events
      SET leased_until = now() - interval '1 second'
      WHERE id = ${event!.id}
    `);
    const reclaimed = await database.outbox.claimDue({
      batchSize: 50,
      leaseMs: 60_000,
      leaseToken: secondToken,
    });
    expect(reclaimed.some((e) => e.id === event!.id)).toBe(true);
    expect((await database.outbox.findById(event!.id))?.leaseToken).toBe(secondToken);

    expect(
      (
        await database.outbox.markPublished({
          eventId: event!.id,
          leaseToken: firstToken,
        })
      ).outcome,
    ).toBe('not_updated');
    expect(
      (
        await database.outbox.markRetry({
          eventId: event!.id,
          leaseToken: firstToken,
          errorCode: 'REDIS_UNAVAILABLE',
          nextAttemptDelayMs: 100,
        })
      ).outcome,
    ).toBe('not_updated');
    expect(
      (
        await database.outbox.markDeadLettered({
          eventId: event!.id,
          leaseToken: firstToken,
          errorCode: 'INVALID_PAYLOAD',
        })
      ).outcome,
    ).toBe('not_updated');
    expect((await database.outbox.findById(event!.id))?.leaseToken).toBe(secondToken);

    expect(
      (
        await database.outbox.markPublished({
          eventId: event!.id,
          leaseToken: secondToken,
        })
      ).outcome,
    ).toBe('updated');
    const published = await database.outbox.findById(event!.id);
    expect(published?.publishedAt).not.toBeNull();
    expect(published?.leaseToken).toBeNull();
    expect(published?.leasedUntil).toBeNull();
  });

  it('never gives the same event to two concurrent claimers', async () => {
    const searches = await Promise.all([
      createQueuedSearch(database),
      createQueuedSearch(database),
      createQueuedSearch(database),
      createQueuedSearch(database),
    ]);
    const eventIds = (
      await Promise.all(searches.map((s) => database.outbox.findByAggregateId(s.id)))
    ).map(([e]) => e!.id);
    await database.db.execute(sql`
      UPDATE outbox_events
      SET lease_token = NULL, leased_until = NULL, next_attempt_at = NULL
      WHERE id IN (${sql.join(
        eventIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    `);

    const [a, b] = await Promise.all([
      database.outbox.claimDue({
        batchSize: 50,
        leaseMs: 60_000,
        leaseToken: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
      database.outbox.claimDue({
        batchSize: 50,
        leaseMs: 60_000,
        leaseToken: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
    ]);
    const aIds = new Set(a.map((e) => e.id));
    const bIds = new Set(b.map((e) => e.id));
    for (const id of eventIds) {
      const inA = aIds.has(id);
      const inB = bIds.has(id);
      expect(inA && inB).toBe(false);
      expect(inA || inB).toBe(true);
    }
  });

  it('dead-letters permanently and prevents reclaim', async () => {
    const search = await createQueuedSearch(database);
    const [event] = await database.outbox.findByAggregateId(search.id);
    await database.db.execute(sql`
      UPDATE outbox_events SET lease_token = NULL, leased_until = NULL WHERE id = ${event!.id}
    `);
    const claimed = await database.outbox.claimDue({
      batchSize: 50,
      leaseMs: 30_000,
      leaseToken: '77777777-7777-4777-8777-777777777777',
    });
    const target = claimed.find((e) => e.id === event!.id);
    expect(target).toBeTruthy();

    const dead = await database.outbox.markDeadLettered({
      eventId: event!.id,
      leaseToken: '77777777-7777-4777-8777-777777777777',
      errorCode: 'INVALID_PAYLOAD',
    });
    expect(dead.outcome).toBe('updated');

    const again = await database.outbox.claimDue({
      batchSize: 50,
      leaseMs: 30_000,
      leaseToken: '88888888-8888-4888-8888-888888888888',
    });
    expect(again.map((e) => e.id)).not.toContain(event!.id);
  });

  it('has due-claim index and lease pair constraint', async () => {
    const indexes = await database.db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'outbox_events' AND indexname = 'outbox_events_due_claim_idx'
    `);
    expect([...(indexes as unknown as Array<{ indexname: string }>)]).toHaveLength(1);

    await expect(
      database.db.execute(sql`
        UPDATE outbox_events
        SET lease_token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, leased_until = NULL
        WHERE id = (SELECT id FROM outbox_events LIMIT 1)
      `),
    ).rejects.toThrow();
  });
});
