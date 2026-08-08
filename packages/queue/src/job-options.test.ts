import { describe, expect, it } from 'vitest';

import { buildMeetingSearchJobOptions } from './job-options.js';

describe('buildMeetingSearchJobOptions', () => {
  it('maps retry, exponential backoff with jitter, and bounded retention to BullMQ defaults', () => {
    const options = buildMeetingSearchJobOptions({
      attempts: 5,
      backoffDelayMs: 2_000,
      backoffJitter: 0.2,
      removeOnCompleteAgeSeconds: 3_600,
      removeOnCompleteCount: 1_000,
      removeOnFailAgeSeconds: 86_400,
      removeOnFailCount: 5_000,
    });

    expect(options.attempts).toBe(5);
    expect(options.backoff).toEqual({
      type: 'exponential',
      delay: 2_000,
      jitter: 0.2,
    });
    expect(options.removeOnComplete).toEqual({ age: 3_600, count: 1_000 });
    expect(options.removeOnFail).toEqual({ age: 86_400, count: 5_000 });
    expect((options.removeOnFail as { age: number }).age).toBeGreaterThanOrEqual(
      (options.removeOnComplete as { age: number }).age,
    );
    expect((options.removeOnFail as { count: number }).count).toBeGreaterThanOrEqual(
      (options.removeOnComplete as { count: number }).count,
    );
    expect((options.removeOnComplete as { age: number }).age).toBeGreaterThan(0);
    expect((options.removeOnFail as { age: number }).age).toBeGreaterThan(0);
  });
});
