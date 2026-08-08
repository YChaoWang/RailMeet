import type { OutboxEventRecord, OutboxRepository } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';
import { describe, expect, it, vi } from 'vitest';

import { computeRetryDelayMs, jitterUnitFromEventId } from './backoff.js';
import {
  assertSafeJobId,
  MEETING_SEARCH_REQUESTED_JOB_NAME,
  MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION,
  MEETING_SEARCHES_QUEUE_NAME,
  meetingSearchRequestedJobId,
} from './contract.js';
import { createOutboxDispatcher } from './dispatcher.js';
import { mapOutboxEventToJob } from './map-event.js';
import { QueueTransientError, type MeetingSearchQueuePublisher } from './publisher.js';

function baseEvent(overrides: Partial<OutboxEventRecord> = {}): OutboxEventRecord {
  const id = overrides.id ?? '11111111-1111-4111-8111-111111111111';
  const searchId = overrides.aggregateId ?? '22222222-2222-4222-8222-222222222222';
  return {
    id,
    eventType: 'meeting-search.requested',
    aggregateType: 'meeting-search',
    aggregateId: searchId,
    schemaVersion: 1,
    dedupeKey: 'default',
    payload: { searchId },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    publishedAt: null,
    failureCount: 0,
    nextAttemptAt: null,
    leaseToken: '33333333-3333-4333-8333-333333333333',
    leasedUntil: new Date('2026-01-01T00:01:00.000Z'),
    lastErrorCode: null,
    deadLetteredAt: null,
    ...overrides,
  };
}

describe('job contract mapping', () => {
  it('maps a valid event to the exact BullMQ job contract', () => {
    const event = baseEvent();
    const mapped = mapOutboxEventToJob(event);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }
    expect(mapped.job).toEqual({
      queueName: MEETING_SEARCHES_QUEUE_NAME,
      jobName: MEETING_SEARCH_REQUESTED_JOB_NAME,
      jobId: meetingSearchRequestedJobId(event.id),
      data: {
        schemaVersion: MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION,
        searchId: event.aggregateId,
      },
    });
  });

  it('uses a deterministic job ID without colons or digit-only form', () => {
    const eventId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const jobId = meetingSearchRequestedJobId(eventId);
    expect(jobId).toBe(`outbox-${eventId}`);
    expect(jobId).not.toContain(':');
    expect(/^\d+$/.test(jobId)).toBe(false);
    expect(() => assertSafeJobId(jobId)).not.toThrow();
  });

  it('rejects unsupported event type as poison', () => {
    const wrongType = mapOutboxEventToJob({
      ...baseEvent(),
      eventType: 'meeting-search.completed' as 'meeting-search.requested',
    });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) {
      expect(wrongType.errorCode).toBe('UNSUPPORTED_EVENT_TYPE');
    }
    const wrongAggregate = mapOutboxEventToJob({
      ...baseEvent(),
      aggregateType: 'other' as 'meeting-search',
    });
    expect(wrongAggregate.ok).toBe(false);
    if (!wrongAggregate.ok) {
      expect(wrongAggregate.errorCode).toBe('UNSUPPORTED_EVENT_TYPE');
    }
  });

  it('rejects unsupported schema version as poison', () => {
    const mapped = mapOutboxEventToJob(baseEvent({ schemaVersion: 99 }));
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.errorCode).toBe('UNSUPPORTED_SCHEMA_VERSION');
    }
  });

  it('rejects invalid payload as poison', () => {
    const mismatched = mapOutboxEventToJob(
      baseEvent({
        payload: { searchId: '00000000-0000-4000-8000-000000000000' },
      }),
    );
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) {
      expect(mismatched.errorCode).toBe('INVALID_PAYLOAD');
    }
    const empty = mapOutboxEventToJob(baseEvent({ payload: { searchId: '' } }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.errorCode).toBe('INVALID_PAYLOAD');
    }
  });
});

describe('outbox dispatcher orchestration', () => {
  it('publishes successfully and marks published; enqueue failure does not', async () => {
    const event = baseEvent({ leaseToken: null, leasedUntil: null });
    const markPublished = vi.fn().mockResolvedValue({ outcome: 'updated' });
    const markRetry = vi.fn().mockResolvedValue({ outcome: 'updated' });
    const outbox: OutboxRepository = {
      findByAggregateId: vi.fn(),
      findUnpublished: vi.fn(),
      findById: vi.fn(),
      claimDue: vi.fn().mockResolvedValue([{ ...event, leaseToken: 'lease-1' }]),
      markPublished,
      markRetry,
      markDeadLettered: vi.fn(),
    };
    const publisher: MeetingSearchQueuePublisher = {
      publishMeetingSearchRequested: vi.fn(),
      publishMappedJob: vi.fn().mockResolvedValue('added'),
      close: vi.fn(),
    };
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const logger = {
      ...createLogger({ name: 'test', level: 'silent', pretty: false }),
      info,
      warn,
      error,
    };

    const dispatcher = createOutboxDispatcher({
      outbox,
      publisher,
      logger,
      config: {
        pollIntervalMs: 10_000,
        batchSize: 10,
        leaseMs: 30_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 2,
      },
      createLeaseToken: () => 'lease-1',
    });

    const stats = await dispatcher.runOnce();
    expect(stats.published).toBe(1);
    expect(markPublished).toHaveBeenCalledWith({
      eventId: event.id,
      leaseToken: 'lease-1',
    });
    expect(JSON.stringify(publisher)).not.toMatch(/redis:\/\/|postgresql:\/\//i);
    const logged = JSON.stringify({
      info: info.mock.calls,
      warn: warn.mock.calls,
      error: error.mock.calls,
    });
    expect(logged).not.toMatch(/redis:\/\/|rediss:\/\/|postgresql:\/\/|postgres:\/\//i);
    expect(logged).not.toMatch(/displayName|originPlaceId|allowedCountry/i);

    publisher.publishMappedJob = vi
      .fn()
      .mockRejectedValue(new QueueTransientError('REDIS_UNAVAILABLE', 'down'));
    outbox.claimDue = vi.fn().mockResolvedValue([
      {
        ...event,
        id: '44444444-4444-4444-8444-444444444444',
        leaseToken: 'lease-1',
        payload: { searchId: event.aggregateId },
        aggregateId: event.aggregateId,
      },
    ]);
    markPublished.mockClear();
    const retryStats = await dispatcher.runOnce();
    expect(retryStats.retried).toBe(1);
    expect(markPublished).not.toHaveBeenCalled();
    expect(markRetry).toHaveBeenCalled();
  });

  it('treats duplicate enqueue as successful delivery', async () => {
    const event = baseEvent();
    const markPublished = vi.fn().mockResolvedValue({ outcome: 'updated' });
    const outbox: OutboxRepository = {
      findByAggregateId: vi.fn(),
      findUnpublished: vi.fn(),
      findById: vi.fn(),
      claimDue: vi.fn().mockResolvedValue([{ ...event, leaseToken: 'lease-1' }]),
      markPublished,
      markRetry: vi.fn(),
      markDeadLettered: vi.fn(),
    };
    const publisher: MeetingSearchQueuePublisher = {
      publishMeetingSearchRequested: vi.fn(),
      publishMappedJob: vi.fn().mockResolvedValue('already_exists'),
      close: vi.fn(),
    };
    const dispatcher = createOutboxDispatcher({
      outbox,
      publisher,
      logger: createLogger({ name: 'test', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 10_000,
        batchSize: 10,
        leaseMs: 30_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 1,
      },
      createLeaseToken: () => 'lease-1',
    });
    await dispatcher.runOnce();
    expect(markPublished).toHaveBeenCalledOnce();
  });

  it('dead-letters poison events and never dead-letters high transient retry counts', async () => {
    const poison = baseEvent({ schemaVersion: 99, leaseToken: null });
    const transient = baseEvent({
      id: '55555555-5555-4555-8555-555555555555',
      failureCount: 50,
      leaseToken: null,
    });
    const markDeadLettered = vi.fn().mockResolvedValue({ outcome: 'updated' });
    const markRetry = vi.fn().mockResolvedValue({ outcome: 'updated' });
    const outbox: OutboxRepository = {
      findByAggregateId: vi.fn(),
      findUnpublished: vi.fn(),
      findById: vi.fn(),
      claimDue: vi.fn().mockResolvedValue([
        { ...poison, leaseToken: 'lease-1' },
        { ...transient, leaseToken: 'lease-1' },
      ]),
      markPublished: vi.fn(),
      markRetry,
      markDeadLettered,
    };
    const publisher: MeetingSearchQueuePublisher = {
      publishMeetingSearchRequested: vi.fn(),
      publishMappedJob: vi
        .fn()
        .mockRejectedValue(new QueueTransientError('REDIS_UNAVAILABLE', 'down')),
      close: vi.fn(),
    };
    const dispatcher = createOutboxDispatcher({
      outbox,
      publisher,
      logger: createLogger({ name: 'test', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 10_000,
        batchSize: 10,
        leaseMs: 30_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 2,
      },
      createLeaseToken: () => 'lease-1',
    });
    const stats = await dispatcher.runOnce();
    expect(stats.deadLettered).toBe(1);
    expect(stats.retried).toBe(1);
    expect(markDeadLettered).toHaveBeenCalledOnce();
    expect(markRetry).toHaveBeenCalledOnce();
  });

  it('continues the batch when one event fails', async () => {
    const a = baseEvent({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const b = baseEvent({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      aggregateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      payload: { searchId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    const markPublished = vi.fn().mockResolvedValue({ outcome: 'updated' });
    const markRetry = vi.fn().mockResolvedValue({ outcome: 'updated' });
    const outbox: OutboxRepository = {
      findByAggregateId: vi.fn(),
      findUnpublished: vi.fn(),
      findById: vi.fn(),
      claimDue: vi.fn().mockResolvedValue([
        { ...a, leaseToken: 'lease-1' },
        { ...b, leaseToken: 'lease-1' },
      ]),
      markPublished,
      markRetry,
      markDeadLettered: vi.fn(),
    };
    const publisher: MeetingSearchQueuePublisher = {
      publishMeetingSearchRequested: vi.fn(),
      publishMappedJob: vi.fn().mockImplementation(async (input) => {
        if (input.jobId.includes('aaaaaaaa')) {
          throw new QueueTransientError('REDIS_UNAVAILABLE', 'fail-a');
        }
        return 'added';
      }),
      close: vi.fn(),
    };
    const dispatcher = createOutboxDispatcher({
      outbox,
      publisher,
      logger: createLogger({ name: 'test', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 10_000,
        batchSize: 10,
        leaseMs: 30_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 1,
      },
      createLeaseToken: () => 'lease-1',
    });
    const stats = await dispatcher.runOnce();
    expect(stats.retried).toBe(1);
    expect(stats.published).toBe(1);
  });

  it('does not overlap cycles and stop waits for in-flight work', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const outbox: OutboxRepository = {
      findByAggregateId: vi.fn(),
      findUnpublished: vi.fn(),
      findById: vi.fn(),
      claimDue: vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await gate;
        inFlight -= 1;
        return [];
      }),
      markPublished: vi.fn(),
      markRetry: vi.fn(),
      markDeadLettered: vi.fn(),
    };
    const publisher: MeetingSearchQueuePublisher = {
      publishMeetingSearchRequested: vi.fn(),
      publishMappedJob: vi.fn(),
      close: vi.fn(),
    };
    const sleeps: Array<() => void> = [];
    const dispatcher = createOutboxDispatcher({
      outbox,
      publisher,
      logger: createLogger({ name: 'test', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 1,
        batchSize: 10,
        leaseMs: 30_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 1,
      },
      sleep: () =>
        new Promise((resolve) => {
          sleeps.push(resolve);
        }),
    });

    dispatcher.start();
    dispatcher.start(); // idempotent
    await new Promise((r) => setTimeout(r, 20));
    expect(maxInFlight).toBe(1);
    const stopPromise = dispatcher.stop();
    release();
    await stopPromise;
    await dispatcher.stop(); // idempotent
    expect(maxInFlight).toBe(1);
  });

  it('ignores stale lease mark-published results', async () => {
    const event = baseEvent();
    const markPublished = vi.fn().mockResolvedValue({ outcome: 'not_updated' });
    const outbox: OutboxRepository = {
      findByAggregateId: vi.fn(),
      findUnpublished: vi.fn(),
      findById: vi.fn(),
      claimDue: vi.fn().mockResolvedValue([{ ...event, leaseToken: 'stale' }]),
      markPublished,
      markRetry: vi.fn(),
      markDeadLettered: vi.fn(),
    };
    const dispatcher = createOutboxDispatcher({
      outbox,
      publisher: {
        publishMeetingSearchRequested: vi.fn(),
        publishMappedJob: vi.fn().mockResolvedValue('added'),
        close: vi.fn(),
      },
      logger: createLogger({ name: 'test', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 10_000,
        batchSize: 10,
        leaseMs: 30_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 1,
      },
      createLeaseToken: () => 'stale',
    });
    const stats = await dispatcher.runOnce();
    expect(stats.published).toBe(0);
  });

  it('does not count stale-lease retry or dead-letter updates as success', async () => {
    const good = baseEvent({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const poison = baseEvent({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      schemaVersion: 99,
    });
    const markRetry = vi.fn().mockResolvedValue({ outcome: 'not_updated' });
    const markDeadLettered = vi.fn().mockResolvedValue({ outcome: 'not_updated' });
    const outbox: OutboxRepository = {
      findByAggregateId: vi.fn(),
      findUnpublished: vi.fn(),
      findById: vi.fn(),
      claimDue: vi.fn().mockResolvedValue([
        { ...good, leaseToken: 'lease-1' },
        { ...poison, leaseToken: 'lease-1' },
      ]),
      markPublished: vi.fn(),
      markRetry,
      markDeadLettered,
    };
    const dispatcher = createOutboxDispatcher({
      outbox,
      publisher: {
        publishMeetingSearchRequested: vi.fn(),
        publishMappedJob: vi
          .fn()
          .mockRejectedValue(new QueueTransientError('REDIS_UNAVAILABLE', 'down')),
        close: vi.fn(),
      },
      logger: createLogger({ name: 'test', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 10_000,
        batchSize: 10,
        leaseMs: 30_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 2,
      },
      createLeaseToken: () => 'lease-1',
    });
    const stats = await dispatcher.runOnce();
    expect(markRetry).toHaveBeenCalledOnce();
    expect(markDeadLettered).toHaveBeenCalledOnce();
    expect(stats.retried).toBe(0);
    expect(stats.deadLettered).toBe(0);
  });

  it('keeps the loop alive across Redis failures and publishes after recovery in-process', async () => {
    const event = baseEvent({ leaseToken: null, leasedUntil: null });
    let redisUp = false;
    const markPublished = vi.fn().mockResolvedValue({ outcome: 'updated' });
    const markRetry = vi.fn().mockResolvedValue({ outcome: 'updated' });
    const claimDue = vi
      .fn()
      .mockImplementation(async () => [{ ...event, leaseToken: 'lease-loop' }]);
    const outbox: OutboxRepository = {
      findByAggregateId: vi.fn(),
      findUnpublished: vi.fn(),
      findById: vi.fn(),
      claimDue,
      markPublished,
      markRetry,
      markDeadLettered: vi.fn(),
    };
    const publisher: MeetingSearchQueuePublisher = {
      publishMeetingSearchRequested: vi.fn(),
      publishMappedJob: vi.fn().mockImplementation(async () => {
        if (!redisUp) {
          throw new QueueTransientError('REDIS_UNAVAILABLE', 'down');
        }
        return 'added';
      }),
      close: vi.fn(),
    };
    let resolveSleep: (() => void) | undefined;
    const dispatcher = createOutboxDispatcher({
      outbox,
      publisher,
      logger: createLogger({ name: 'test', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 1,
        batchSize: 10,
        leaseMs: 30_000,
        retryBaseMs: 100,
        retryMaxMs: 1_000,
        publishConcurrency: 1,
      },
      createLeaseToken: () => 'lease-loop',
      sleep: (_ms, signal) =>
        new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          resolveSleep = resolve;
          const onAbort = (): void => {
            reject(new Error('aborted'));
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }),
    });

    dispatcher.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(markRetry.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(markPublished).not.toHaveBeenCalled();

    redisUp = true;
    resolveSleep?.();
    await new Promise((r) => setTimeout(r, 40));
    if (markPublished.mock.calls.length === 0) {
      resolveSleep?.();
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(markPublished).toHaveBeenCalled();

    await dispatcher.stop();
    const callsAfterStop = claimDue.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(claimDue.mock.calls.length).toBe(callsAfterStop);
  });
});

describe('backoff', () => {
  it('caps delay and stays deterministic for an event id', () => {
    const a = computeRetryDelayMs({
      failureCount: 20,
      baseMs: 1_000,
      maxMs: 5_000,
      jitterUnit: jitterUnitFromEventId('same-id'),
    });
    const b = computeRetryDelayMs({
      failureCount: 20,
      baseMs: 1_000,
      maxMs: 5_000,
      jitterUnit: jitterUnitFromEventId('same-id'),
    });
    expect(a).toBe(b);
    expect(a).toBeLessThanOrEqual(6_000);
  });
});
