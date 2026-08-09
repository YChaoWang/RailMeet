import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMeetingSearch } from './meeting-search-client';

describe('meeting-search client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts create payloads to the same-origin proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        data: {
          searchId: '44444444-4444-4444-8444-444444444444',
          status: 'queued',
          createdAt: '2026-06-01T12:00:00.000Z',
        },
        meta: { requestId: 'r1' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createMeetingSearch({
      participants: [
        { id: 'a', displayName: 'A', origin: { placeId: 'place:berlin' } },
        { id: 'b', displayName: 'B', origin: { placeId: 'place:paris' } },
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
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/meeting-searches',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces validation failures without treating them as search failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed',
            requestId: 'r1',
            details: [{ path: 'participants', message: 'At least 2 participants are required' }],
          },
        }),
      }),
    );

    const result = await createMeetingSearch({
      participants: [{ id: 'a', displayName: 'A', origin: { placeId: 'place:berlin' } }],
      travelDate: '2026-06-15',
      earliestDepartureTime: '08:00',
      latestArrivalTime: '22:00',
      arrivalDayOffset: 0,
      maxJourneyDurationMinutes: 480,
      maxTransfers: 2,
      minTransferDurationMinutes: 5,
      allowedTransportModes: ['train'],
      rankingMode: 'fairest',
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });
});
