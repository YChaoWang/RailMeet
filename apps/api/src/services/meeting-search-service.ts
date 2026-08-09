import type {
  FinalizationRepository,
  MeetingSearchRepository,
  PlaceNotFoundError,
  PlaceRepository,
} from '@railmeet/database';
import { isDatabaseUnavailableError, isUniqueViolationError } from '@railmeet/database';
import type {
  CreateMeetingSearchRequest,
  MeetingSearchAcceptedData,
  MeetingSearchDetailData,
  MeetingSearchResultsData,
} from '@railmeet/validation';

import {
  toCreateMeetingSearchCommand,
  toMeetingSearchAcceptedData,
  toMeetingSearchDetailData,
  toMeetingSearchResultsData,
} from '../mappers/meeting-search-mapper.js';

export type MeetingSearchServiceError =
  | { readonly kind: 'invalid_place'; readonly placeIds: readonly string[] }
  | { readonly kind: 'not_found'; readonly searchId: string }
  | { readonly kind: 'results_not_ready'; readonly searchId: string }
  | {
      readonly kind: 'search_failed';
      readonly searchId: string;
      readonly failureCode: string | null;
    }
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
  getSearchResults: (
    searchId: string,
  ) => Promise<MeetingSearchServiceResult<MeetingSearchResultsData>>;
};

export type MeetingSearchServiceDeps = {
  readonly meetingSearches: MeetingSearchRepository;
  readonly places: PlaceRepository;
  readonly finalization: FinalizationRepository;
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
        const placeIds = [
          ...search.participants.map((participant) => participant.originPlaceId),
          ...(search.recommendedDestinationPlaceId ? [search.recommendedDestinationPlaceId] : []),
        ];
        const places = await deps.places.findManyByIds(placeIds);
        const placesById = new Map(
          places.map((place) => [
            place.id,
            {
              placeId: place.id,
              name: place.name,
              longitude: place.location.longitude,
              latitude: place.location.latitude,
            },
          ]),
        );
        return { ok: true, value: toMeetingSearchDetailData(search, placesById) };
      } catch (error) {
        return { ok: false, error: mapUnexpectedPersistenceFailure(error) };
      }
    },

    async getSearchResults(searchId) {
      try {
        const model = await deps.finalization.loadRankedResults(searchId);
        switch (model.kind) {
          case 'not_found':
            return { ok: false, error: { kind: 'not_found', searchId } };
          case 'not_ready':
            return { ok: false, error: { kind: 'results_not_ready', searchId } };
          case 'failed':
            return {
              ok: false,
              error: {
                kind: 'search_failed',
                searchId,
                failureCode: model.failureCode,
              },
            };
          case 'completed':
            return { ok: true, value: toMeetingSearchResultsData(model) };
          default: {
            const _exhaustive: never = model;
            return { ok: false, error: { kind: 'internal', cause: _exhaustive } };
          }
        }
      } catch (error) {
        return { ok: false, error: mapUnexpectedPersistenceFailure(error) };
      }
    },
  };
}
