import type { CreateMeetingSearchCommand, MeetingSearchRecord } from '@railmeet/database';
import type {
  CreateMeetingSearchRequest,
  MeetingSearchAcceptedData,
  MeetingSearchDetailData,
} from '@railmeet/validation';

/**
 * Maps the Zod-validated create DTO into the persistence command.
 * Deliberate boundary mapping — not a pass-through of HTTP or Drizzle shapes.
 */
export function toCreateMeetingSearchCommand(
  request: CreateMeetingSearchRequest,
): CreateMeetingSearchCommand {
  return {
    participants: request.participants.map((participant, position) => ({
      participantId: participant.id,
      displayName: participant.displayName,
      originPlaceId: participant.origin.placeId,
      position,
    })),
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

export function toMeetingSearchDetailData(search: MeetingSearchRecord): MeetingSearchDetailData {
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
      origin: { placeId: participant.originPlaceId },
    })),
    allowedTransportModes: [...search.allowedTransportModes],
    allowedCountryCodes: [...search.allowedCountryCodes],
    createdAt: search.createdAt.toISOString(),
    updatedAt: search.updatedAt.toISOString(),
  };
}
