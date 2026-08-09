import type {
  CreateMeetingSearchCommand,
  MeetingSearchRecord,
  PlaceViewRecord,
  RankedResultsReadModel,
  UpsertProviderPlaceCommand,
} from '@railmeet/database';
import { placeKindFromSuggestionType } from '@railmeet/database';
import type { SearchFailureCode } from '@railmeet/shared';
import { isSearchFailureCode } from '@railmeet/shared';
import type {
  CreateMeetingSearchRequest,
  MeetingSearchAcceptedData,
  MeetingSearchDetailData,
  MeetingSearchResultsData,
} from '@railmeet/validation';
import { isSelectedPlaceOrigin } from '@railmeet/validation';

/**
 * Maps the Zod-validated create DTO into the persistence command.
 * Deliberate boundary mapping — not a pass-through of HTTP or Drizzle shapes.
 */
export function toCreateMeetingSearchCommand(
  request: CreateMeetingSearchRequest,
): CreateMeetingSearchCommand {
  return {
    participants: request.participants.map((participant, position) => {
      const origin = participant.origin;
      if (isSelectedPlaceOrigin(origin)) {
        if (!origin.countryCode) {
          throw new Error('Selected place missing countryCode after validation');
        }
        const selection: UpsertProviderPlaceCommand = {
          provider: 'motis',
          providerPlaceId: origin.providerId,
          name: origin.name,
          kind: placeKindFromSuggestionType(origin.type),
          countryCode: origin.countryCode,
          timezone: origin.timezone ?? 'UTC',
          location: {
            longitude: origin.longitude,
            latitude: origin.latitude,
          },
        };
        return {
          participantId: participant.id,
          displayName: participant.displayName,
          origin: { kind: 'providerSelection', selection },
          position,
        };
      }
      return {
        participantId: participant.id,
        displayName: participant.displayName,
        origin: { kind: 'existing', placeId: origin.placeId },
        position,
      };
    }),
    travelDate: request.travelDate,
    earliestDepartureTime: request.earliestDepartureTime,
    latestArrivalTime: request.latestArrivalTime,
    arrivalDayOffset: request.arrivalDayOffset,
    maxJourneyDurationMinutes: request.maxJourneyDurationMinutes,
    maxTransfers: request.maxTransfers,
    minTransferDurationMinutes: request.minTransferDurationMinutes,
    allowedTransportModes: request.allowedTransportModes,
    ...(request.allowedCountryCodes !== undefined
      ? { allowedCountryCodes: request.allowedCountryCodes }
      : {}),
    rankingMode: request.rankingMode,
    status: 'queued',
  };
}

export function toMeetingSearchAcceptedData(
  search: MeetingSearchRecord,
): MeetingSearchAcceptedData {
  return {
    searchId: search.id,
    status: 'queued',
    createdAt: search.createdAt.toISOString(),
  };
}

function toPublicFailureCode(code: string | null): SearchFailureCode | null {
  if (code === null) {
    return null;
  }
  return isSearchFailureCode(code) ? code : 'INVARIANT_VIOLATION';
}

function toPlaceView(place: PlaceViewRecord | null | undefined): {
  placeId: string;
  name?: string;
  longitude?: number;
  latitude?: number;
} | null {
  if (!place) {
    return null;
  }
  return {
    placeId: place.placeId,
    ...(place.name ? { name: place.name } : {}),
    ...(place.longitude !== null && place.longitude !== undefined
      ? { longitude: place.longitude }
      : {}),
    ...(place.latitude !== null && place.latitude !== undefined
      ? { latitude: place.latitude }
      : {}),
  };
}

/**
 * Maps a persisted search into the public summary DTO.
 * Place names/coordinates come from a separate places lookup (never invented from IDs).
 */
export function toMeetingSearchDetailData(
  search: MeetingSearchRecord,
  placesById: ReadonlyMap<string, PlaceViewRecord> = new Map(),
): MeetingSearchDetailData {
  const recommendedId = search.recommendedDestinationPlaceId;
  return {
    searchId: search.id,
    status: search.status,
    travelDate: search.travelDate,
    earliestDepartureTime: search.earliestDepartureTime,
    latestArrivalTime: search.latestArrivalTime,
    arrivalDayOffset: search.arrivalDayOffset,
    maxJourneyDurationMinutes: search.maxJourneyDurationMinutes,
    maxTransfers: search.maxTransfers,
    minTransferDurationMinutes: search.minTransferDurationMinutes,
    rankingMode: search.rankingMode,
    participants: search.participants.map((participant) => ({
      id: participant.participantId,
      displayName: participant.displayName,
      origin: toPlaceView(
        placesById.get(participant.originPlaceId) ?? {
          placeId: participant.originPlaceId,
          name: null,
          longitude: null,
          latitude: null,
        },
      )!,
    })),
    allowedTransportModes: [...search.allowedTransportModes],
    allowedCountryCodes: [...search.allowedCountryCodes],
    createdAt: search.createdAt.toISOString(),
    updatedAt: search.updatedAt.toISOString(),
    startedAt: search.startedAt?.toISOString() ?? null,
    completedAt: search.completedAt?.toISOString() ?? null,
    failedAt: search.failedAt?.toISOString() ?? null,
    completionOutcome: search.completionOutcome,
    failureCode: toPublicFailureCode(search.failureCode),
    recommendedDestination: recommendedId
      ? toPlaceView(
          placesById.get(recommendedId) ?? {
            placeId: recommendedId,
            name: null,
            longitude: null,
            latitude: null,
          },
        )
      : null,
  };
}

function mapPlace(place: PlaceViewRecord): {
  placeId: string;
  name?: string;
  longitude?: number;
  latitude?: number;
} {
  return toPlaceView(place)!;
}

export function toMeetingSearchResultsData(
  model: Extract<RankedResultsReadModel, { kind: 'completed' }>,
): MeetingSearchResultsData {
  return {
    searchId: model.searchId,
    status: 'completed',
    completionOutcome: model.completionOutcome,
    rankingMode: model.rankingMode,
    recommendedDestination: toPlaceView(model.recommendedDestination),
    rankings: model.rankings.map((candidate) => ({
      rankingMode: candidate.rankingMode,
      rank: candidate.rank,
      destination: mapPlace(candidate.destination),
      recommended: candidate.recommended,
      totalDurationMinutes: candidate.totalDurationMinutes,
      maxDurationMinutes: candidate.maxDurationMinutes,
      durationRangeMinutes: candidate.durationRangeMinutes,
      totalTransfers: candidate.totalTransfers,
      maxTransfers: candidate.maxTransfers,
      earliestArrivalAt: candidate.earliestArrivalAt.toISOString(),
      latestArrivalAt: candidate.latestArrivalAt.toISOString(),
      arrivalSpreadMs: candidate.arrivalSpreadMs,
      journeys: candidate.journeys.map((journey) => ({
        participantId: journey.participantId,
        participantDisplayName: journey.participantDisplayName,
        participantPosition: journey.participantPosition,
        origin: mapPlace(journey.origin),
        destination: mapPlace(journey.destination),
        departureAt: journey.departureAt.toISOString(),
        arrivalAt: journey.arrivalAt.toISOString(),
        durationMinutes: journey.durationMinutes,
        transfers: journey.transfers,
        transportModes: [...journey.transportModes],
        legs: journey.legs.map((leg) => ({
          mode: leg.mode,
          departureAt: leg.departureAt.toISOString(),
          arrivalAt: leg.arrivalAt.toISOString(),
          durationMinutes: leg.durationMinutes,
          geometry: leg.geometry
            ? {
                points: leg.geometry.points,
                precision: leg.geometry.precision,
                length: leg.geometry.length,
              }
            : null,
        })),
      })),
    })),
  };
}
