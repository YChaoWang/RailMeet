/**
 * Transactional outbox constants for durable processing intent.
 * Phase 4–5 write/publish meeting-search.requested; Phase 7 adds candidates + routing.
 */

export const OUTBOX_EVENT_TYPES = [
  'meeting-search.requested',
  'meeting-search.candidates-requested',
  'routing.requested',
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

export const OUTBOX_AGGREGATE_TYPES = ['meeting-search'] as const;
export type OutboxAggregateType = (typeof OUTBOX_AGGREGATE_TYPES)[number];

export const MEETING_SEARCH_AGGREGATE_TYPE = 'meeting-search' as const;

export const MEETING_SEARCH_REQUESTED_EVENT_TYPE = 'meeting-search.requested' as const;
export const MEETING_SEARCH_REQUESTED_SCHEMA_VERSION = 1 as const;

export const MEETING_SEARCH_CANDIDATES_REQUESTED_EVENT_TYPE =
  'meeting-search.candidates-requested' as const;
export const MEETING_SEARCH_CANDIDATES_REQUESTED_SCHEMA_VERSION = 1 as const;

export const ROUTING_REQUESTED_EVENT_TYPE = 'routing.requested' as const;
export const ROUTING_REQUESTED_SCHEMA_VERSION = 1 as const;

export const OUTBOX_DEDUPE_KEY_DEFAULT = 'default' as const;

export type MeetingSearchRequestedPayload = {
  readonly searchId: string;
};

export type MeetingSearchCandidatesRequestedPayload = {
  readonly searchId: string;
};

export type RoutingRequestedPayload = {
  readonly searchId: string;
  readonly routingWorkId: string;
};

export type OutboxPayload =
  MeetingSearchRequestedPayload | MeetingSearchCandidatesRequestedPayload | RoutingRequestedPayload;

export function isOutboxEventType(value: string): value is OutboxEventType {
  return (OUTBOX_EVENT_TYPES as readonly string[]).includes(value);
}

export function isOutboxAggregateType(value: string): value is OutboxAggregateType {
  return (OUTBOX_AGGREGATE_TYPES as readonly string[]).includes(value);
}
