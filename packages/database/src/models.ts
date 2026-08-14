import type {
  JourneyLegIdentityFields,
  MotisPlanItineraryPayload,
  PlaceKind,
  RankingMode,
  RouteSummarySegment,
  SearchCompletionOutcome,
  SearchStatus,
  TransportMode,
} from '@railmeet/shared';

import type { OutboxAggregateType, OutboxEventType, OutboxPayload } from './outbox.js';

export type CandidateGenerationStatus = 'pending' | 'running' | 'succeeded' | 'failed_permanent';

export type RoutingWorkStatus = 'pending' | 'running' | 'succeeded' | 'no_journeys' | 'exhausted';

/** Geographic point using PostGIS convention: x = longitude, y = latitude (SRID 4326). */
export type GeoPoint = {
  readonly longitude: number;
  readonly latitude: number;
};

export type PlaceRecord = {
  readonly id: string;
  readonly name: string;
  readonly kind: PlaceKind;
  readonly countryCode: string;
  readonly timezone: string;
  readonly location: GeoPoint;
  readonly parentCityId: string | null;
  readonly provider: string | null;
  readonly providerPlaceId: string | null;
  readonly ownership: string;
  readonly sourceVersion: string | null;
  readonly normalizedName: string | null;
  readonly population: number | null;
  readonly featureCode: string | null;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type CreatePlaceCommand = {
  readonly id: string;
  readonly name: string;
  readonly kind: PlaceKind;
  readonly countryCode: string;
  readonly timezone: string;
  readonly location: GeoPoint;
  readonly parentCityId?: string | null;
  readonly provider?: string | null;
  readonly providerPlaceId?: string | null;
};

export type UpsertProviderPlaceCommand = {
  readonly provider: 'motis';
  readonly providerPlaceId: string;
  readonly name: string;
  readonly kind: PlaceKind;
  readonly countryCode: string;
  readonly timezone: string;
  readonly location: GeoPoint;
};

export type MeetingSearchOriginResolution =
  | { readonly kind: 'existing'; readonly placeId: string }
  | { readonly kind: 'providerSelection'; readonly selection: UpsertProviderPlaceCommand };

export type CreateMeetingSearchParticipantCommand = {
  readonly participantId: string;
  readonly displayName: string;
  readonly origin: MeetingSearchOriginResolution;
  readonly position: number;
};

/**
 * Explicit persistence command for creating a meeting-search aggregate.
 * Not a Drizzle row and not the Zod DTO — callers map from validated input.
 */
export type CreateMeetingSearchCommand = {
  readonly participants: readonly CreateMeetingSearchParticipantCommand[];
  readonly travelDate: string;
  readonly earliestDepartureTime: string;
  readonly latestArrivalTime: string;
  readonly arrivalDayOffset: 0 | 1;
  readonly maxJourneyDurationMinutes: number;
  readonly maxTransfers: number;
  readonly minTransferDurationMinutes: number;
  readonly allowedTransportModes: readonly TransportMode[];
  readonly allowedCountryCodes?: readonly string[];
  readonly rankingMode: RankingMode;
  /** Defaults to `queued` when omitted. */
  readonly status?: SearchStatus;
};

export type MeetingSearchParticipantRecord = {
  readonly participantId: string;
  readonly displayName: string;
  readonly originPlaceId: string;
  readonly position: number;
};

export type { SearchCompletionOutcome };

export type CandidateFeasibilityReason =
  | 'feasible'
  | 'participant_no_journeys'
  | 'routing_incomplete'
  | 'technical_failure'
  | 'invariant_violation';

export type MeetingSearchRecord = {
  readonly id: string;
  readonly status: SearchStatus;
  readonly travelDate: string;
  readonly earliestDepartureTime: string;
  readonly latestArrivalTime: string;
  readonly arrivalDayOffset: 0 | 1;
  readonly maxJourneyDurationMinutes: number;
  readonly maxTransfers: number;
  readonly minTransferDurationMinutes: number;
  readonly rankingMode: RankingMode;
  readonly participants: readonly MeetingSearchParticipantRecord[];
  readonly allowedTransportModes: readonly TransportMode[];
  /** Empty array means no country restriction. */
  readonly allowedCountryCodes: readonly string[];
  /** Set once on first queued→running kickoff; null while still queued. */
  readonly startedAt: Date | null;
  /** Set once on running→completed (Phase 8). */
  readonly completedAt: Date | null;
  /** Set once on running→failed (Phase 8). */
  readonly failedAt: Date | null;
  readonly completionOutcome: SearchCompletionOutcome | null;
  readonly failureCode: string | null;
  readonly recommendedDestinationPlaceId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type FinalizeMeetingSearchResult =
  | {
      readonly outcome: 'completed';
      readonly searchId: string;
      readonly completionOutcome: SearchCompletionOutcome;
      readonly recommendedDestinationPlaceId: string | null;
    }
  | {
      readonly outcome: 'failed';
      readonly searchId: string;
      readonly failureCode: string;
    }
  | { readonly outcome: 'not_ready'; readonly searchId: string }
  | {
      readonly outcome: 'already_terminal';
      readonly searchId: string;
      readonly status: SearchStatus;
    }
  | { readonly outcome: 'not_found'; readonly searchId: string };

export type ConditionalStatusUpdateResult =
  | { readonly outcome: 'updated'; readonly search: MeetingSearchRecord }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'conflict'; readonly currentStatus: SearchStatus };

/**
 * Idempotent Phase 6 kickoff result for queued → running.
 * Does not reopen terminal searches and never resets startedAt.
 */
export type SearchKickoffResult =
  | {
      readonly outcome: 'started';
      readonly searchId: string;
      readonly startedAt: Date;
    }
  | {
      readonly outcome: 'already_started';
      readonly searchId: string;
      readonly startedAt: Date | null;
    }
  | {
      readonly outcome: 'already_terminal';
      readonly searchId: string;
      readonly status: SearchStatus;
      readonly startedAt: Date | null;
    }
  | { readonly outcome: 'not_found'; readonly searchId: string };

export type OutboxEventRecord = {
  readonly id: string;
  readonly eventType: OutboxEventType;
  readonly aggregateType: OutboxAggregateType;
  readonly aggregateId: string;
  readonly schemaVersion: number;
  readonly dedupeKey: string;
  readonly payload: OutboxPayload;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
  readonly failureCount: number;
  readonly nextAttemptAt: Date | null;
  readonly leaseToken: string | null;
  readonly leasedUntil: Date | null;
  readonly lastErrorCode: string | null;
  readonly deadLetteredAt: Date | null;
};

export type CandidateGenerationRecord = {
  readonly searchId: string;
  readonly status: CandidateGenerationStatus;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type MeetingSearchCandidateRecord = {
  readonly searchId: string;
  readonly destinationPlaceId: string;
  readonly ordinal: number;
  readonly distanceMeters: number;
  readonly routingHubPlaceId: string | null;
  readonly routingTargetReason: 'hub' | 'centroid_fallback' | null;
  readonly createdAt: Date;
};

export type NearestCityCandidate = {
  readonly placeId: string;
  readonly distanceMeters: number;
};

export type RoutingWorkRecord = {
  readonly id: string;
  readonly searchId: string;
  readonly participantId: string;
  readonly destinationPlaceId: string;
  readonly status: RoutingWorkStatus;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type EncodedRouteGeometryRecord = {
  readonly points: string;
  readonly precision: number;
  readonly length: number;
};

export type PersistedJourneyLeg = JourneyLegIdentityFields & {
  readonly mode: string;
  readonly departureAt: Date;
  readonly arrivalAt: Date;
  readonly durationMinutes: number;
  readonly providerReference?: string;
  readonly geometry?: EncodedRouteGeometryRecord;
};

export type PersistedJourneyRecord = {
  readonly id: string;
  readonly routingWorkId: string;
  readonly journeyOrdinal: number;
  readonly departureAt: Date;
  readonly arrivalAt: Date;
  readonly durationMinutes: number;
  readonly transfers: number;
  readonly transportModes: readonly string[];
  readonly legs: readonly PersistedJourneyLeg[];
  readonly providerReference: string | null;
  readonly providerItinerary: MotisPlanItineraryPayload | null;
  readonly createdAt: Date;
};

export type PersistJourneyInput = {
  readonly journeyOrdinal: number;
  readonly departureAt: Date;
  readonly arrivalAt: Date;
  readonly durationMinutes: number;
  readonly transfers: number;
  readonly transportModes: readonly string[];
  readonly legs: readonly PersistedJourneyLeg[];
  readonly providerReference?: string;
  readonly providerItinerary?: MotisPlanItineraryPayload;
};

export type ClaimOutboxEventsCommand = {
  readonly batchSize: number;
  readonly leaseMs: number;
  readonly leaseToken: string;
};

export type MarkOutboxPublishedCommand = {
  readonly eventId: string;
  readonly leaseToken: string;
};

export type MarkOutboxRetryCommand = {
  readonly eventId: string;
  readonly leaseToken: string;
  readonly errorCode: string;
  readonly nextAttemptDelayMs: number;
};

export type MarkOutboxDeadLetterCommand = {
  readonly eventId: string;
  readonly leaseToken: string;
  readonly errorCode: string;
};

export type ConditionalOutboxUpdateResult =
  { readonly outcome: 'updated' } | { readonly outcome: 'not_updated' };

/**
 * Place identity for Phase 9 read models.
 * Coordinates come from persisted `places.location` only (never geocoded in the UI).
 */
export type PlaceViewRecord = {
  readonly placeId: string;
  readonly name: string | null;
  readonly longitude: number | null;
  readonly latitude: number | null;
};

export type RankedJourneyLegRecord = JourneyLegIdentityFields & {
  readonly mode: string;
  readonly departureAt: Date;
  readonly arrivalAt: Date;
  readonly durationMinutes: number;
  readonly geometry: EncodedRouteGeometryRecord | null;
};

export type RankedParticipantJourneyRecord = {
  readonly journeyId: string;
  readonly participantId: string;
  readonly participantDisplayName: string;
  readonly participantPosition: number;
  readonly origin: PlaceViewRecord;
  readonly destination: PlaceViewRecord;
  readonly departureAt: Date;
  readonly arrivalAt: Date;
  readonly durationMinutes: number;
  readonly transfers: number;
  readonly transportModes: readonly string[];
  readonly legs: readonly RankedJourneyLegRecord[];
  readonly routeSummary: readonly RouteSummarySegment[];
  /** Internal only — used to build routeSummary / detail; never mapped into compact results. */
  readonly providerItinerary: MotisPlanItineraryPayload | null;
};

export type JourneyDetailSource = 'provider' | 'legacy';

export type JourneyDetailRecord = {
  readonly journeyId: string;
  readonly detailSource: JourneyDetailSource;
  readonly itineraryId: string | null;
  readonly providerItinerary: MotisPlanItineraryPayload | null;
  readonly legs: readonly RankedJourneyLegRecord[];
  readonly providerItineraryUnavailableReason: string | null;
};

export type JourneyDetailReadModel =
  | { readonly kind: 'not_found' }
  | {
      readonly kind: 'not_ready';
      readonly searchId: string;
      readonly status: SearchStatus;
    }
  | {
      readonly kind: 'failed';
      readonly searchId: string;
      readonly failureCode: string | null;
    }
  | {
      readonly kind: 'completed';
      readonly searchId: string;
      readonly detail: JourneyDetailRecord;
    };

export type RankedCandidateRecord = {
  readonly rankingMode: RankingMode;
  readonly rank: number;
  readonly destination: PlaceViewRecord;
  readonly recommended: boolean;
  readonly totalDurationMinutes: number;
  readonly maxDurationMinutes: number;
  readonly durationRangeMinutes: number;
  readonly totalTransfers: number;
  readonly maxTransfers: number;
  readonly earliestArrivalAt: Date;
  readonly latestArrivalAt: Date;
  readonly arrivalSpreadMs: number;
  readonly journeys: readonly RankedParticipantJourneyRecord[];
};

/**
 * Phase 9 ranked-results read model. Built only from persisted Phase 8 rows.
 * Failed searches never produce a `completed` payload.
 */
export type RankedResultsReadModel =
  | { readonly kind: 'not_found' }
  | {
      readonly kind: 'not_ready';
      readonly searchId: string;
      readonly status: SearchStatus;
    }
  | {
      readonly kind: 'failed';
      readonly searchId: string;
      readonly failureCode: string | null;
    }
  | {
      readonly kind: 'completed';
      readonly searchId: string;
      readonly completionOutcome: SearchCompletionOutcome;
      readonly rankingMode: RankingMode;
      readonly recommendedDestination: PlaceViewRecord | null;
      readonly rankings: readonly RankedCandidateRecord[];
      /** Fixed query count used to assemble this payload (N+1 evidence). */
      readonly queryCount: number;
    };
