/**
 * Stable BullMQ queue / job contracts for outbox dispatch.
 * Infrastructure protocol — not domain vocabulary for `@railmeet/shared`.
 */

export const MEETING_SEARCHES_QUEUE_NAME = 'meeting-searches' as const;
export const MEETING_SEARCH_CANDIDATES_QUEUE_NAME = 'meeting-search-candidates' as const;
export const MEETING_SEARCH_ROUTING_QUEUE_NAME = 'meeting-search-routing' as const;

export const MEETING_SEARCH_REQUESTED_JOB_NAME = 'meeting-search.requested' as const;
export const MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_NAME =
  'meeting-search.candidates-requested' as const;
export const ROUTING_REQUESTED_JOB_NAME = 'routing.requested' as const;

export const MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION = 1 as const;
export const MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_SCHEMA_VERSION = 1 as const;
export const ROUTING_REQUESTED_JOB_SCHEMA_VERSION = 1 as const;

export type MeetingSearchRequestedJobData = {
  readonly schemaVersion: typeof MEETING_SEARCH_REQUESTED_JOB_SCHEMA_VERSION;
  readonly searchId: string;
};

export type MeetingSearchCandidatesRequestedJobData = {
  readonly schemaVersion: typeof MEETING_SEARCH_CANDIDATES_REQUESTED_JOB_SCHEMA_VERSION;
  readonly searchId: string;
};

export type RoutingRequestedJobData = {
  readonly schemaVersion: typeof ROUTING_REQUESTED_JOB_SCHEMA_VERSION;
  readonly searchId: string;
  readonly routingWorkId: string;
};

export type OutboxMappedJobData =
  MeetingSearchRequestedJobData | MeetingSearchCandidatesRequestedJobData | RoutingRequestedJobData;

/** Deterministic BullMQ job ID derived from the outbox event UUID. */
export function outboxJobId(eventId: string): string {
  return `outbox-${eventId}`;
}

/** @deprecated Use outboxJobId — kept for Phase 5/6 call sites. */
export function meetingSearchRequestedJobId(eventId: string): string {
  return outboxJobId(eventId);
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
