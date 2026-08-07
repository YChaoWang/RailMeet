export { createDatabase, type Database, type DatabaseConfig } from './client.js';

export {
  isDatabaseUnavailableError,
  isUniqueViolationError,
  placeNotFound,
  searchNotFound,
  statusConflict,
  type PersistenceError,
  type PlaceNotFoundError,
  type SearchNotFoundError,
  type StatusConflictError,
} from './errors.js';

export {
  MEETING_SEARCH_AGGREGATE_TYPE,
  MEETING_SEARCH_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_REQUESTED_SCHEMA_VERSION,
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_EVENT_TYPES,
  isOutboxAggregateType,
  isOutboxEventType,
  type MeetingSearchRequestedPayload,
  type OutboxAggregateType,
  type OutboxEventType,
} from './outbox.js';

export type {
  ClaimOutboxEventsCommand,
  ConditionalOutboxUpdateResult,
  ConditionalStatusUpdateResult,
  CreateMeetingSearchCommand,
  CreateMeetingSearchParticipantCommand,
  CreatePlaceCommand,
  GeoPoint,
  MarkOutboxDeadLetterCommand,
  MarkOutboxPublishedCommand,
  MarkOutboxRetryCommand,
  MeetingSearchParticipantRecord,
  MeetingSearchRecord,
  OutboxEventRecord,
  PlaceRecord,
} from './models.js';

export type { MeetingSearchRepository } from './repositories/meeting-search-repository.js';
export type { OutboxRepository } from './repositories/outbox-repository.js';
export type { PlaceRepository } from './repositories/place-repository.js';
export { assertPostgisInstalled } from './repositories/place-repository.js';

/** Schema exports for Drizzle Kit and advanced consumers — not API response types. */
export * as schema from './schema/index.js';
