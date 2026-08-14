import { createLogger } from '@railmeet/observability';
import {
  meetingSearchAcceptedEnvelopeSchema,
  meetingSearchDetailEnvelopeSchema,
  meetingSearchResultsEnvelopeSchema,
} from '@railmeet/validation';
import { describe, expect, it, vi } from 'vitest';

import { buildServer } from './app.js';
import type { MeetingSearchService } from './services/meeting-search-service.js';

const REQUEST_ID = 'req-test-0001';

const validBody = {
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
  allowedTransportModes: ['train', 'bus'],
  allowedCountryCodes: ['DE', 'FR'],
  rankingMode: 'fairest',
};

const acceptedValue = {
  searchId: '44444444-4444-4444-8444-444444444444',
  status: 'queued' as const,
  createdAt: '2026-06-01T12:00:00.000Z',
};

const detailValue = {
  searchId: '44444444-4444-4444-8444-444444444444',
  status: 'queued' as const,
  travelDate: '2026-06-15',
  earliestDepartureTime: '08:00',
  latestArrivalTime: '22:00',
  arrivalDayOffset: 0 as const,
  maxJourneyDurationMinutes: 480,
  maxTransfers: 2,
  minTransferDurationMinutes: 5,
  rankingMode: 'fairest' as const,
  participants: [
    { id: 'p1', displayName: 'Alex', origin: { placeId: 'place:berlin', name: 'Berlin' } },
    { id: 'p2', displayName: 'Blake', origin: { placeId: 'place:paris', name: 'Paris' } },
  ],
  allowedTransportModes: ['bus', 'train'] as Array<'bus' | 'train'>,
  allowedCountryCodes: ['DE', 'FR'],
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
  startedAt: null,
  completedAt: null,
  failedAt: null,
  completionOutcome: null,
  failureCode: null,
  recommendedDestination: null,
};

const resultsValue = {
  searchId: '44444444-4444-4444-8444-444444444444',
  status: 'completed' as const,
  completionOutcome: 'ranked' as const,
  rankingMode: 'fairest' as const,
  recommendedDestination: { placeId: 'place:munich', name: 'Munich' },
  rankings: [
    {
      rankingMode: 'arrive-together' as const,
      rank: 1,
      destination: { placeId: 'place:munich', name: 'Munich' },
      recommended: false,
      totalDurationMinutes: 120,
      maxDurationMinutes: 70,
      durationRangeMinutes: 20,
      totalTransfers: 1,
      maxTransfers: 1,
      earliestArrivalAt: '2026-06-15T10:00:00.000Z',
      latestArrivalAt: '2026-06-15T10:10:00.000Z',
      arrivalSpreadMs: 600_000,
      journeys: [
        {
          journeyId: '11111111-1111-4111-8111-111111111111',
          participantId: 'p1',
          participantDisplayName: 'Alex',
          participantPosition: 0,
          origin: { placeId: 'place:berlin', name: 'Berlin' },
          destination: { placeId: 'place:munich', name: 'Munich' },
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T10:00:00.000Z',
          durationMinutes: 120,
          transfers: 0,
          transportModes: ['train'],
          routeSummary: [{ mode: 'HIGHSPEED_RAIL', displayName: 'ICE', routeColor: '#9c27b0' }],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T08:00:00.000Z',
              arrivalAt: '2026-06-15T10:00:00.000Z',
              durationMinutes: 120,
              geometry: null,
            },
          ],
        },
        {
          journeyId: '22222222-2222-4222-8222-222222222222',
          participantId: 'p2',
          participantDisplayName: 'Blake',
          participantPosition: 1,
          origin: { placeId: 'place:paris', name: 'Paris' },
          destination: { placeId: 'place:munich', name: 'Munich' },
          departureAt: '2026-06-15T08:10:00.000Z',
          arrivalAt: '2026-06-15T10:10:00.000Z',
          durationMinutes: 120,
          transfers: 1,
          transportModes: ['train'],
          routeSummary: [{ mode: 'HIGHSPEED_RAIL', displayName: 'TGV', routeColor: '#9c27b0' }],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T08:10:00.000Z',
              arrivalAt: '2026-06-15T10:10:00.000Z',
              durationMinutes: 120,
              geometry: null,
            },
          ],
        },
      ],
    },
    {
      rankingMode: 'fairest' as const,
      rank: 1,
      destination: { placeId: 'place:munich', name: 'Munich' },
      recommended: true,
      totalDurationMinutes: 140,
      maxDurationMinutes: 75,
      durationRangeMinutes: 10,
      totalTransfers: 2,
      maxTransfers: 1,
      earliestArrivalAt: '2026-06-15T09:10:00.000Z',
      latestArrivalAt: '2026-06-15T09:20:00.000Z',
      arrivalSpreadMs: 600_000,
      journeys: [],
    },
  ],
};

const journeyDetailValue = {
  journeyId: '11111111-1111-4111-8111-111111111111',
  detailSource: 'provider' as const,
  itineraryId: 'itinerary:fixture:v1',
  providerItinerary: {
    format: 'motis-plan-itinerary-v1' as const,
    motisPlanApiVersion: 'v5' as const,
    motisOpenApiPin: 'motis@2.10.2:/api/v5/plan',
    itinerary: {
      duration: 100,
      startTime: '2026-06-15T08:00:00Z',
      endTime: '2026-06-15T10:00:00Z',
      transfers: 0,
      id: 'itinerary:fixture:v1',
      legs: [
        {
          mode: 'HIGHSPEED_RAIL',
          displayName: 'ICE',
          agencyName: 'DB',
          startTime: '2026-06-15T08:00:00Z',
          endTime: '2026-06-15T10:00:00Z',
          duration: 7200,
          from: { name: 'Berlin', track: '1' },
          to: { name: 'Munich', track: '2' },
        },
      ],
    },
  },
  legs: [
    {
      mode: 'train',
      departureAt: '2026-06-15T08:00:00.000Z',
      arrivalAt: '2026-06-15T10:00:00.000Z',
      durationMinutes: 120,
      geometry: null,
      displayName: 'ICE',
    },
  ],
  providerItineraryUnavailableReason: null,
};

function createFakeService(overrides: Partial<MeetingSearchService> = {}): MeetingSearchService {
  return {
    createAcceptedSearch: vi.fn().mockResolvedValue({ ok: true, value: acceptedValue }),
    getSearchById: vi.fn().mockResolvedValue({ ok: true, value: detailValue }),
    getSearchResults: vi.fn().mockResolvedValue({ ok: true, value: resultsValue }),
    getJourneyDetail: vi.fn().mockResolvedValue({ ok: true, value: journeyDetailValue }),
    ...overrides,
  };
}

async function buildTestApp(service: MeetingSearchService = createFakeService()) {
  const logger = createLogger({
    name: 'railmeet-api-test',
    level: 'silent',
    pretty: false,
  });
  return buildServer({
    logger,
    genReqId: () => REQUEST_ID,
    meetingSearchService: service,
  });
}

describe('meeting-search API', () => {
  it('POST returns 202 with Location, envelope, and matching request IDs', async () => {
    const service = createFakeService();
    const app = await buildTestApp(service);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      payload: validBody,
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers.location).toBe(`/api/v1/meeting-searches/${acceptedValue.searchId}`);
    expect(response.headers['x-request-id']).toBe(REQUEST_ID);

    const body = response.json();
    expect(meetingSearchAcceptedEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.meta.requestId).toBe(REQUEST_ID);
    expect(body.data.status).toBe('queued');
    expect(service.createAcceptedSearch).toHaveBeenCalledOnce();
    expect(service.createAcceptedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        participants: expect.arrayContaining([
          expect.objectContaining({ id: 'p1', origin: { placeId: 'place:berlin' } }),
        ]),
      }),
    );

    await app.close();
  });

  it('rejects unknown request fields', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      payload: { ...validBody, unexpected: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(response.json())).not.toMatch(/stack|SQL|postgres/i);
    await app.close();
  });

  it('rejects malformed JSON safely', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      headers: { 'content-type': 'application/json' },
      payload: '{"participants":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(response.json().error.requestId).toBe(REQUEST_ID);
    expect(response.headers['x-request-id']).toBe(REQUEST_ID);
    await app.close();
  });

  it('rejects invalid participant constraints', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      payload: {
        ...validBody,
        participants: [{ id: 'only-one', displayName: 'Solo', origin: { placeId: 'place:x' } }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    await app.close();
  });

  it('maps invalid canonical origin to 422', async () => {
    const app = await buildTestApp(
      createFakeService({
        createAcceptedSearch: vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: 'invalid_place', placeIds: ['place:missing'] },
        }),
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      payload: validBody,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_PLACE_REFERENCE');
    await app.close();
  });

  it('maps repository conflict to 409', async () => {
    const app = await buildTestApp(
      createFakeService({
        createAcceptedSearch: vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: 'conflict', message: 'Conflict' },
        }),
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      payload: validBody,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
    await app.close();
  });

  it('maps unexpected errors to safe 500', async () => {
    const app = await buildTestApp(
      createFakeService({
        createAcceptedSearch: vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: 'internal', cause: new Error('secret boom') },
        }),
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      payload: validBody,
    });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret boom');
    expect(JSON.stringify(body)).not.toContain('stack');
    await app.close();
  });

  it('maps database unavailable to 503', async () => {
    const app = await buildTestApp(
      createFakeService({
        createAcceptedSearch: vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: 'unavailable', message: 'The database is temporarily unavailable' },
        }),
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      payload: validBody,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('SERVICE_UNAVAILABLE');
    await app.close();
  });

  it('GET returns 200 with deliberate projection and deterministic ordering', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${detailValue.searchId}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(meetingSearchDetailEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.data.allowedTransportModes).toEqual(['bus', 'train']);
    expect(body.data.allowedCountryCodes).toEqual(['DE', 'FR']);
    expect(body.data.participants.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2']);
    expect(body.data).not.toHaveProperty('outbox');
    expect(JSON.stringify(body)).not.toContain('publishedAt');
    await app.close();
  });

  it('GET summary returns every lifecycle status safely', async () => {
    const statuses = [
      'queued',
      'running',
      'partially-completed',
      'completed',
      'failed',
      'cancelling',
      'cancelled',
    ] as const;
    for (const status of statuses) {
      const app = await buildTestApp(
        createFakeService({
          getSearchById: vi.fn().mockResolvedValue({
            ok: true,
            value: {
              ...detailValue,
              status,
              completionOutcome: status === 'completed' ? 'ranked' : null,
              failureCode: status === 'failed' ? 'ROUTING_TECHNICAL_FAILURE' : null,
              completedAt: status === 'completed' ? '2026-06-01T12:05:00.000Z' : null,
              failedAt: status === 'failed' ? '2026-06-01T12:05:00.000Z' : null,
            },
          }),
        }),
      );
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/meeting-searches/${detailValue.searchId}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.status).toBe(status);
      expect(body.error).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/stack|SELECT |providerPayload|BullMQ|redis/i);
      await app.close();
    }
  });

  it('GET returns 404 for missing search', async () => {
    const app = await buildTestApp(
      createFakeService({
        getSearchById: vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: 'not_found', searchId: detailValue.searchId },
        }),
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${detailValue.searchId}`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
    await app.close();
  });

  it('GET returns 400 for malformed search ID', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/meeting-searches/not-a-uuid',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    await app.close();
  });

  it('GET results returns 200 with ranked payload and deterministic order', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${resultsValue.searchId}/results`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(meetingSearchResultsEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(
      body.data.rankings.map((row: { rankingMode: string; rank: number }) => [
        row.rankingMode,
        row.rank,
      ]),
    ).toEqual([
      ['arrive-together', 1],
      ['fairest', 1],
    ]);
    expect(
      body.data.rankings[0].journeys.map((j: { participantId: string }) => j.participantId),
    ).toEqual(['p1', 'p2']);
    expect(JSON.stringify(body)).not.toMatch(/stack|SELECT |providerPayload/i);
    await app.close();
  });

  it('GET results returns 409 RESULTS_NOT_READY while queued or running', async () => {
    const app = await buildTestApp(
      createFakeService({
        getSearchResults: vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: 'results_not_ready', searchId: detailValue.searchId },
        }),
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${detailValue.searchId}/results`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('RESULTS_NOT_READY');
    await app.close();
  });

  it('GET results returns 409 SEARCH_FAILED without ranking rows', async () => {
    const app = await buildTestApp(
      createFakeService({
        getSearchResults: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            kind: 'search_failed',
            searchId: detailValue.searchId,
            failureCode: 'ROUTING_TECHNICAL_FAILURE',
          },
        }),
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${detailValue.searchId}/results`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SEARCH_FAILED');
    expect(response.json().error.details?.[0]?.message).toBe('ROUTING_TECHNICAL_FAILURE');
    expect(response.json()).not.toHaveProperty('data');
    await app.close();
  });

  it('GET results returns 409 SEARCH_FAILED for cancelled searches', async () => {
    const app = await buildTestApp(
      createFakeService({
        getSearchResults: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            kind: 'search_failed',
            searchId: detailValue.searchId,
            failureCode: null,
          },
        }),
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${detailValue.searchId}/results`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SEARCH_FAILED');
    expect(response.json()).not.toHaveProperty('data');
    await app.close();
  });

  it('GET results returns empty completed payloads for no_candidates and no_feasible_candidates', async () => {
    for (const completionOutcome of ['no_candidates', 'no_feasible_candidates'] as const) {
      const app = await buildTestApp(
        createFakeService({
          getSearchResults: vi.fn().mockResolvedValue({
            ok: true,
            value: {
              ...resultsValue,
              completionOutcome,
              recommendedDestination: null,
              rankings: [],
            },
          }),
        }),
      );
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/meeting-searches/${resultsValue.searchId}/results`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(meetingSearchResultsEnvelopeSchema.safeParse(body).success).toBe(true);
      expect(body.data.completionOutcome).toBe(completionOutcome);
      expect(body.data.rankings).toEqual([]);
      expect(body.data.status).toBe('completed');
      await app.close();
    }
  });

  it('GET results preserves multi-candidate rank and participant ordinal order', async () => {
    const ordered = {
      ...resultsValue,
      rankings: [
        {
          ...resultsValue.rankings[1]!,
          rank: 1,
          destination: { placeId: 'place:munich', name: 'Munich' },
          journeys: [
            {
              journeyId: '00000009-aaaa-4aaa-8aaa-000000000009',
              routeSummary: [{ mode: 'RAIL', displayName: 'ICE' }],
              participantId: 'p1',
              participantDisplayName: 'Alex',
              participantPosition: 0,
              origin: { placeId: 'place:berlin', name: 'Berlin' },
              destination: { placeId: 'place:munich', name: 'Munich' },
              departureAt: '2026-06-15T08:00:00.000Z',
              arrivalAt: '2026-06-15T10:00:00.000Z',
              durationMinutes: 120,
              transfers: 0,
              transportModes: ['train'],
              legs: [],
            },
            {
              journeyId: '0000000a-aaaa-4aaa-8aaa-00000000000a',
              routeSummary: [{ mode: 'RAIL', displayName: 'ICE' }],
              participantId: 'p2',
              participantDisplayName: 'Blake',
              participantPosition: 1,
              origin: { placeId: 'place:paris', name: 'Paris' },
              destination: { placeId: 'place:munich', name: 'Munich' },
              departureAt: '2026-06-15T08:10:00.000Z',
              arrivalAt: '2026-06-15T10:10:00.000Z',
              durationMinutes: 120,
              transfers: 1,
              transportModes: ['train'],
              legs: [],
            },
          ],
        },
        {
          ...resultsValue.rankings[1]!,
          rank: 2,
          recommended: false,
          destination: { placeId: 'place:cologne', name: 'Cologne' },
          journeys: [],
        },
      ],
    };
    const app = await buildTestApp(
      createFakeService({
        getSearchResults: vi.fn().mockResolvedValue({ ok: true, value: ordered }),
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${resultsValue.searchId}/results`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.rankings.map((row: { rank: number }) => row.rank)).toEqual([1, 2]);
    expect(
      body.data.rankings[0].journeys.map(
        (journey: { participantPosition: number }) => journey.participantPosition,
      ),
    ).toEqual([0, 1]);
    await app.close();
  });

  it('GET results returns 404 for unknown search', async () => {
    const app = await buildTestApp(
      createFakeService({
        getSearchResults: vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: 'not_found', searchId: detailValue.searchId },
        }),
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${detailValue.searchId}/results`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
    await app.close();
  });

  it('GET results returns 400 for malformed search ID', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/meeting-searches/not-a-uuid/results',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    await app.close();
  });

  it('response schemas prevent unexpected property leakage on success', async () => {
    const leakyService = createFakeService({
      createAcceptedSearch: vi.fn().mockResolvedValue({
        ok: true,
        value: Object.assign({}, acceptedValue, {
          internalRowId: 'should-not-leak',
          sql: 'SELECT 1',
        }),
      }),
    });
    const app = await buildTestApp(leakyService);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      payload: validBody,
    });
    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.data).not.toHaveProperty('internalRowId');
    expect(body.data).not.toHaveProperty('sql');
    expect(meetingSearchAcceptedEnvelopeSchema.safeParse(body).success).toBe(true);
    await app.close();
  });

  it('keeps /health backward compatible', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'railmeet-api',
    });
    await app.close();
  });

  it('does not trust client x-request-id as the server request ID', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      headers: { 'x-request-id': 'client-supplied-unbounded-value' },
      payload: validBody,
    });
    expect(response.headers['x-request-id']).toBe(REQUEST_ID);
    expect(response.json().meta.requestId).toBe(REQUEST_ID);
    await app.close();
  });

  it('GET results exposes journeyId and routeSummary without providerItinerary', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${resultsValue.searchId}/results`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const journey = body.data.rankings[0].journeys[0];
    expect(journey.journeyId).toBe('11111111-1111-4111-8111-111111111111');
    expect(journey.routeSummary[0].displayName).toBe('ICE');
    expect(JSON.stringify(body)).not.toContain('providerItinerary');
    await app.close();
  });

  it('GET journey detail returns provider source', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${resultsValue.searchId}/journeys/11111111-1111-4111-8111-111111111111`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.detailSource).toBe('provider');
    expect(body.data.providerItinerary?.itinerary.legs[0].displayName).toBe('ICE');
    await app.close();
  });

  it('GET journey detail returns legacy source', async () => {
    const app = await buildTestApp(
      createFakeService({
        getJourneyDetail: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            journeyId: '11111111-1111-4111-8111-111111111111',
            detailSource: 'legacy',
            itineraryId: null,
            providerItinerary: null,
            legs: [
              {
                mode: 'train',
                departureAt: '2026-06-15T08:00:00.000Z',
                arrivalAt: '2026-06-15T10:00:00.000Z',
                durationMinutes: 120,
                geometry: null,
              },
            ],
            providerItineraryUnavailableReason: null,
          },
        }),
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${resultsValue.searchId}/journeys/11111111-1111-4111-8111-111111111111`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.detailSource).toBe('legacy');
    expect(response.json().data.providerItinerary).toBeNull();
    await app.close();
  });

  it('GET journey detail returns 404 for mismatched association', async () => {
    const app = await buildTestApp(
      createFakeService({
        getJourneyDetail: vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: 'not_found', searchId: resultsValue.searchId },
        }),
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/meeting-searches/${resultsValue.searchId}/journeys/99999999-9999-4999-8999-999999999999`,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

});
