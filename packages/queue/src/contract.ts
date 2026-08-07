/**
 * Stable BullMQ queue / job contract for meeting-search outbox dispatch.
 * Infrastructure protocol — not domain vocabulary for `@railmeet/shared`.
 */

export const MEETING_SEARCHES_QUEUE_NAME = 'meeting-searches' as const;

export const MEETING_SEARCH_REQUESTED_JOB_NAME = 'meeting-search.requested' as const;

export const MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION = 1 as const;

export type MeetingSearchRequestedJobData = {
  readonly schemaVersion: typeof MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION;
  readonly searchId: string;
};

/** Deterministic BullMQ job ID derived from the outbox event UUID. */
export function meetingSearchRequestedJobId(eventId: string): string {
  return `outbox-${eventId}`;
}

export function assertSafeJobId(jobId: string): void {
  if (jobId.includes(':')) {
    throw new Error('BullMQ job ID must not contain a colon');
  }
  if (/^\d+$/.test(jobId)) {
    throw new Error('BullMQ job ID must not consist only of digits');
  }
}

export type OutboxPoisonErrorCode =
  'UNSUPPORTED_EVENT_TYPE' | 'UNSUPPORTED_SCHEMA_VERSION' | 'INVALID_PAYLOAD';

export type OutboxTransientErrorCode =
  'REDIS_UNAVAILABLE' | 'QUEUE_TIMEOUT' | 'QUEUE_TRANSIENT_FAILURE';
