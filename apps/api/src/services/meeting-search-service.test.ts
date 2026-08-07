import type { MeetingSearchRepository } from '@railmeet/database';
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

function createRepoMock(overrides: Partial<MeetingSearchRepository> = {}): MeetingSearchRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    updateStatusIf: vi.fn(),
    deleteById: vi.fn(),
    ...overrides,
  };
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
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        updatedAt: new Date('2026-06-01T12:00:00.000Z'),
      },
    });
    const service = createMeetingSearchService({
      meetingSearches: createRepoMock({ create }),
    });

    const result = await service.createAcceptedSearch(sampleRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.status).toBe('queued');
    expect(create).toHaveBeenCalledOnce();
    const command = create.mock.calls[0]?.[0];
    expect(command?.participants[0]?.originPlaceId).toBe('place:berlin');
  });

  it('maps PLACE_NOT_FOUND to invalid_place', async () => {
    const service = createMeetingSearchService({
      meetingSearches: createRepoMock({
        create: vi.fn().mockResolvedValue({
          ok: false,
          error: placeNotFound(['place:missing']),
        }),
      }),
    });

    const result = await service.createAcceptedSearch(sampleRequest);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe('invalid_place');
  });

  it('maps unique violations to conflict', async () => {
    const service = createMeetingSearchService({
      meetingSearches: createRepoMock({
        create: vi.fn().mockRejectedValue({ code: '23505' }),
      }),
    });

    const result = await service.createAcceptedSearch(sampleRequest);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe('conflict');
  });

  it('maps connection failures to unavailable', async () => {
    const service = createMeetingSearchService({
      meetingSearches: createRepoMock({
        create: vi.fn().mockRejectedValue({ code: 'ECONNREFUSED' }),
      }),
    });

    const result = await service.createAcceptedSearch(sampleRequest);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe('unavailable');
  });

  it('returns not_found when search is missing', async () => {
    const service = createMeetingSearchService({
      meetingSearches: createRepoMock({
        findById: vi.fn().mockResolvedValue(null),
      }),
    });

    const result = await service.getSearchById('33333333-3333-4333-8333-333333333333');
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.kind).toBe('not_found');
  });
});
