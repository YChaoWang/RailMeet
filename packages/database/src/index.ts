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
  MEETING_SEARCH_CANDIDATES_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_CANDIDATES_REQUESTED_SCHEMA_VERSION,
  MEETING_SEARCH_FINALIZATION_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_FINALIZATION_REQUESTED_SCHEMA_VERSION,
  MEETING_SEARCH_REQUESTED_EVENT_TYPE,
  MEETING_SEARCH_REQUESTED_SCHEMA_VERSION,
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_DEDUPE_KEY_DEFAULT,
  OUTBOX_EVENT_TYPES,
  ROUTING_REQUESTED_EVENT_TYPE,
  ROUTING_REQUESTED_SCHEMA_VERSION,
  candidateGenerationFinalizationDedupeKey,
  isOutboxAggregateType,
  isOutboxEventType,
  routingWorkFinalizationDedupeKey,
  type MeetingSearchCandidatesRequestedPayload,
  type MeetingSearchFinalizationRequestedPayload,
  type MeetingSearchRequestedPayload,
  type OutboxAggregateType,
  type OutboxEventType,
  type OutboxPayload,
  type RoutingRequestedPayload,
} from './outbox.js';

export type {
  CandidateGenerationRecord,
  CandidateGenerationStatus,
  ClaimOutboxEventsCommand,
  ConditionalOutboxUpdateResult,
  ConditionalStatusUpdateResult,
  CreateMeetingSearchCommand,
  CreateMeetingSearchParticipantCommand,
  CandidateFeasibilityReason,
  CreatePlaceCommand,
  FinalizeMeetingSearchResult,
  GeoPoint,
  MarkOutboxDeadLetterCommand,
  MarkOutboxPublishedCommand,
  MarkOutboxRetryCommand,
  MeetingSearchCandidateRecord,
  MeetingSearchParticipantRecord,
  MeetingSearchRecord,
  NearestCityCandidate,
  OutboxEventRecord,
  PersistJourneyInput,
  PersistedJourneyLeg,
  PersistedJourneyRecord,
  PlaceRecord,
  RoutingWorkRecord,
  RoutingWorkStatus,
  SearchCompletionOutcome,
  SearchKickoffResult,
} from './models.js';

export type { FinalizationRepository } from './repositories/finalization-repository.js';
export type { MeetingSearchRepository } from './repositories/meeting-search-repository.js';
export type { OutboxRepository } from './repositories/outbox-repository.js';
export type { PlaceRepository } from './repositories/place-repository.js';
export type {
  ClaimCandidateGenerationResult,
  ClaimRoutingWorkResult,
  FanOutRoutingInput,
  SearchPipelineRepository,
} from './repositories/search-pipeline-repository.js';
export { assertPostgisInstalled } from './repositories/place-repository.js';

/** Schema exports for Drizzle Kit and advanced consumers — not API response types. */
export * as schema from './schema/index.js';
