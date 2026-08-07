import type { MeetingSearchRepository, PlaceNotFoundError } from '@railmeet/database';
import { isDatabaseUnavailableError, isUniqueViolationError } from '@railmeet/database';
import type {
  CreateMeetingSearchRequest,
  MeetingSearchAcceptedData,
  MeetingSearchDetailData,
} from '@railmeet/validation';

import {
  toCreateMeetingSearchCommand,
  toMeetingSearchAcceptedData,
  toMeetingSearchDetailData,
} from '../mappers/meeting-search-mapper.js';

export type MeetingSearchServiceError =
  | { readonly kind: 'invalid_place'; readonly placeIds: readonly string[] }
  | { readonly kind: 'not_found'; readonly searchId: string }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'internal'; readonly cause: unknown };

export type MeetingSearchServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MeetingSearchServiceError };

export type MeetingSearchService = {
  createAcceptedSearch: (
    request: CreateMeetingSearchRequest,
  ) => Promise<MeetingSearchServiceResult<MeetingSearchAcceptedData>>;
  getSearchById: (searchId: string) => Promise<MeetingSearchServiceResult<MeetingSearchDetailData>>;
};

export type MeetingSearchServiceDeps = {
  readonly meetingSearches: MeetingSearchRepository;
};

function fromPlaceNotFound(error: PlaceNotFoundError): MeetingSearchServiceError {
  return { kind: 'invalid_place', placeIds: error.placeIds };
}

function mapUnexpectedPersistenceFailure(error: unknown): MeetingSearchServiceError {
  if (isUniqueViolationError(error)) {
    return {
      kind: 'conflict',
      message: 'The meeting search conflicts with an existing resource',
    };
  }
  if (isDatabaseUnavailableError(error)) {
    return {
      kind: 'unavailable',
      message: 'The database is temporarily unavailable',
    };
  }
  return { kind: 'internal', cause: error };
}

export function createMeetingSearchService(deps: MeetingSearchServiceDeps): MeetingSearchService {
  return {
    async createAcceptedSearch(request) {
      const command = toCreateMeetingSearchCommand(request);
      try {
        const result = await deps.meetingSearches.create(command);
        if (!result.ok) {
          return { ok: false, error: fromPlaceNotFound(result.error) };
        }
        return { ok: true, value: toMeetingSearchAcceptedData(result.value) };
      } catch (error) {
        return { ok: false, error: mapUnexpectedPersistenceFailure(error) };
      }
    },

    async getSearchById(searchId) {
      try {
        const search = await deps.meetingSearches.findById(searchId);
        if (!search) {
          return { ok: false, error: { kind: 'not_found', searchId } };
        }
        return { ok: true, value: toMeetingSearchDetailData(search) };
      } catch (error) {
        return { ok: false, error: mapUnexpectedPersistenceFailure(error) };
      }
    },
  };
}
