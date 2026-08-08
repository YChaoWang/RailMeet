import type { DefaultJobOptions } from 'bullmq';

export type MeetingSearchJobRetentionOptions = {
  readonly attempts: number;
  readonly backoffDelayMs: number;
  /** BullMQ native backoff jitter fraction in [0, 1]. */
  readonly backoffJitter: number;
  readonly removeOnCompleteAgeSeconds: number;
  readonly removeOnCompleteCount: number;
  readonly removeOnFailAgeSeconds: number;
  readonly removeOnFailCount: number;
};

/**
 * Producer-side BullMQ defaults for newly enqueued meeting-search jobs.
 *
 * Existing Phase 5 jobs retain their original unbounded retention options and may
 * remain indefinitely unless explicitly cleaned up. Phase 6 does not automatically
 * delete or migrate those jobs. Bounded retention applies only to newly produced jobs.
 * After a completed/failed Redis job is removed, its deterministic job ID may be
 * accepted again; PostgreSQL kickoff idempotency preserves correctness.
 */
export function buildMeetingSearchJobOptions(
  options: MeetingSearchJobRetentionOptions,
): DefaultJobOptions {
  return {
    attempts: options.attempts,
    backoff: {
      type: 'exponential',
      delay: options.backoffDelayMs,
      jitter: options.backoffJitter,
    },
    removeOnComplete: {
      age: options.removeOnCompleteAgeSeconds,
      count: options.removeOnCompleteCount,
    },
    removeOnFail: {
      age: options.removeOnFailAgeSeconds,
      count: options.removeOnFailCount,
    },
  };
}
