import type { PlaceKind, RankingMode, SearchStatus, TransportMode } from '@railmeet/shared';

import type {
  MeetingSearchRequestedPayload,
  OutboxAggregateType,
  OutboxEventType,
} from './outbox.js';

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
};

export type CreateMeetingSearchParticipantCommand = {
  readonly participantId: string;
  readonly displayName: string;
  readonly originPlaceId: string;
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
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ConditionalStatusUpdateResult =
  | { readonly outcome: 'updated'; readonly search: MeetingSearchRecord }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'conflict'; readonly currentStatus: SearchStatus };

export type OutboxEventRecord = {
  readonly id: string;
  readonly eventType: OutboxEventType;
  readonly aggregateType: OutboxAggregateType;
  readonly aggregateId: string;
  readonly schemaVersion: number;
  readonly payload: MeetingSearchRequestedPayload;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
  readonly failureCount: number;
  readonly nextAttemptAt: Date | null;
  readonly leaseToken: string | null;
  readonly leasedUntil: Date | null;
  readonly lastErrorCode: string | null;
  readonly deadLetteredAt: Date | null;
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
