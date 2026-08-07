import { describe, expect, it, vi } from 'vitest';

import { createOutboxDispatcher } from '@railmeet/queue';
import { createLogger } from '@railmeet/observability';
import type { OutboxRepository } from '@railmeet/database';

describe('worker dispatcher lifecycle smoke', () => {
  it('starts and stops without leaking an overlapping loop', async () => {
    const claimDue = vi.fn().mockResolvedValue([]);
    const outbox: OutboxRepository = {
      findByAggregateId: vi.fn(),
      findUnpublished: vi.fn(),
      findById: vi.fn(),
      claimDue,
      markPublished: vi.fn(),
      markRetry: vi.fn(),
      markDeadLettered: vi.fn(),
    };

    let resolveSleep: (() => void) | undefined;
    const dispatcher = createOutboxDispatcher({
      outbox,
      publisher: {
        publishMeetingSearchRequested: vi.fn(),
        close: vi.fn(),
      },
      logger: createLogger({ name: 'worker-smoke', level: 'silent', pretty: false }),
      config: {
        pollIntervalMs: 50,
        batchSize: 5,
        leaseMs: 30_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
        publishConcurrency: 1,
      },
      sleep: () =>
        new Promise<void>((resolve) => {
          resolveSleep = resolve;
        }),
    });

    dispatcher.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(claimDue.mock.calls.length).toBeGreaterThanOrEqual(1);
    const stopPromise = dispatcher.stop();
    resolveSleep?.();
    await stopPromise;
    const callsAfterStop = claimDue.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(claimDue.mock.calls.length).toBe(callsAfterStop);
  });
});
