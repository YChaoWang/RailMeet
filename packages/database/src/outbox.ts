/**
 * Transactional outbox constants for durable processing intent.
 * Phase 4 writes events; Phase 5 will dispatch unpublished rows to BullMQ.
 */

export const OUTBOX_EVENT_TYPES = ['meeting-search.requested'] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

export const OUTBOX_AGGREGATE_TYPES = ['meeting-search'] as const;
export type OutboxAggregateType = (typeof OUTBOX_AGGREGATE_TYPES)[number];

export const MEETING_SEARCH_REQUESTED_EVENT_TYPE = 'meeting-search.requested' as const;
export const MEETING_SEARCH_AGGREGATE_TYPE = 'meeting-search' as const;
export const MEETING_SEARCH_REQUESTED_SCHEMA_VERSION = 1 as const;

export type MeetingSearchRequestedPayload = {
  readonly searchId: string;
};

export function isOutboxEventType(value: string): value is OutboxEventType {
  return (OUTBOX_EVENT_TYPES as readonly string[]).includes(value);
}

export function isOutboxAggregateType(value: string): value is OutboxAggregateType {
  return (OUTBOX_AGGREGATE_TYPES as readonly string[]).includes(value);
}
