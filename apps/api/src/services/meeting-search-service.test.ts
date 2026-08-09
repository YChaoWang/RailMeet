import type {
  FinalizationRepository,
  MeetingSearchRepository,
  PlaceRepository,
} from '@railmeet/database';
import { placeNotFound } from '@railmeet/database';
import type { CreateMeetingSearchRequest } from '@railmeet/validation';
import { describe, expect, it, vi } from 'vitest';

import { createMeetingSearchService } from './meeting-search-service.js';

const sampleRequest: CreateMeetingSearchRequest = {
  participants: [
    { id: 'p1', displayName: 'Alex', origin: { placeId: 'place:berlin' } },
    { id: 'p2', displayName: 'Blake', origin: { placeId: 'place:paris' } },
  ],
  travelDate: '2026-06-15',
  earliestDepartureTime: '08:00',
  latestArrivalTime: '22:00',
  arrivalDayOffset: 0,
  maxJourneyDurationMinutes: 480,
  maxTransfers: 2,
  minTransferDurationMinutes: 5,
  allowedTransportModes: ['train'],
  rankingMode: 'fairest',
};

const terminalFields = {
  startedAt: null,
  completedAt: null,
  failedAt: null,
  completionOutcome: null,
  failureCode: null,
  recommendedDestinationPlaceId: null,
} as const;

function createRepoMock(overrides: Partial<MeetingSearchRepository> = {}): MeetingSearchRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    updateStatusIf: vi.fn(),
    deleteById: vi.fn(),
    tryKickoff: vi.fn(),
    ...overrides,
  } as MeetingSearchRepository;
}

function createPlacesMock(overrides: Partial<PlaceRepository> = {}): PlaceRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findManyByIds: vi.fn().mockResolvedValue([]),
    deleteById: vi.fn(),
    hasSpatialIndex: vi.fn(),
    ...overrides,
  } as PlaceRepository;
}

function createFinalizationMock(
  overrides: Partial<FinalizationRepository> = {},
): FinalizationRepository {
  return {
    finalizeMeetingSearch: vi.fn(),
    loadRankedResults: vi.fn(),
    listCandidateEvaluations: vi.fn(),
    listCandidateRankings: vi.fn(),
    listRankingJourneys: vi.fn(),
    ...overrides,
  } as FinalizationRepository;
}

function createService(options?: {
  meetingSearches?: Partial<MeetingSearchRepository>;
  places?: Partial<PlaceRepository>;
  finalization?: Partial<FinalizationRepository>;
}) {
  return createMeetingSearchService({
    meetingSearches: createRepoMock(options?.meetingSearches),
    places: createPlacesMock(options?.places),
    finalization: createFinalizationMock(options?.finalization),
  });
}

describe('meeting-search service', () => {
  it('returns accepted data after successful create', async () => {
    const create = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: '22222222-2222-4222-8222-222222222222',
        status: 'queued',
        travelDate: '2026-06-15',
        earliestDepartureTime: '08:00',
        latestArrivalTime: '22:00',
        arrivalDayOffset: 0,
        maxJourneyDurationMinutes: 480,
        maxTransfers: 2,
        minTransferDurationMinutes: 5,
        rankingMode: 'fairest',
        participants: [],
        allowedTransportModes: ['train'],
        allowedCountryCodes: [],
        ...terminalFields,
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        updatedAt: new Date('2026-06-01T12:00:00.000Z'),
      },
    });
    const service = createService({ meetingSearches: { create } });

    const result = await service.createAcceptedSearch(sampleRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.status).toBe('queued');
    expect(create).toHaveBeenCalledOnce();
    const command = create.mock.calls[0]?.[0];
    expect(command?.participants[0]?.origin).toEqual({
      kind: 'existing',
      placeId: 'place:berlin',
    });
  });

  it('maps PLACE_NOT_FOUND to invalid_place', async () => {
    const service = createService({
      meetingSearches: {
        create: vi.fn().mockResolvedValue({
          ok: false,
          error: placeNotFound(['place:missing']),
        }),
      },
    });

    const result = await service.createAcceptedSearch(sampleRequest);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe('invalid_place');
  });

  it('maps unique violations to conflict', async () => {
    const service = createService({
      meetingSearches: {
        create: vi.fn().mockRejectedValue({ code: '23505' }),
      },
    });

    const result = await service.createAcceptedSearch(sampleRequest);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe('conflict');
  });

  it('maps connection failures to unavailable', async () => {
    const service = createService({
      meetingSearches: {
        create: vi.fn().mockRejectedValue({ code: 'ECONNREFUSED' }),
      },
    });

    const result = await service.createAcceptedSearch(sampleRequest);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe('unavailable');
  });

  it('returns not_found when search is missing', async () => {
    const service = createService({
      meetingSearches: {
        findById: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await service.getSearchById('33333333-3333-4333-8333-333333333333');
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe('not_found');
  });

  it('maps results_not_ready and search_failed from ranked-results reads', async () => {
    const loadRankedResults = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'not_ready',
        searchId: '33333333-3333-4333-8333-333333333333',
        status: 'running',
      })
      .mockResolvedValueOnce({
        kind: 'failed',
        searchId: '33333333-3333-4333-8333-333333333333',
        failureCode: 'ROUTING_TECHNICAL_FAILURE',
      });
    const service = createService({ finalization: { loadRankedResults } });

    const pending = await service.getSearchResults('33333333-3333-4333-8333-333333333333');
    expect(pending.ok).toBe(false);
    if (!pending.ok) {
      expect(pending.error.kind).toBe('results_not_ready');
    }

    const failed = await service.getSearchResults('33333333-3333-4333-8333-333333333333');
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.kind).toBe('search_failed');
    }
  });
});
