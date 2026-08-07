import { createLogger } from '@railmeet/observability';
import {
  meetingSearchAcceptedEnvelopeSchema,
  meetingSearchDetailEnvelopeSchema,
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
    { id: 'p1', displayName: 'Alex', origin: { placeId: 'place:berlin' } },
    { id: 'p2', displayName: 'Blake', origin: { placeId: 'place:paris' } },
  ],
  allowedTransportModes: ['bus', 'train'] as Array<'bus' | 'train'>,
  allowedCountryCodes: ['DE', 'FR'],
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
};

function createFakeService(overrides: Partial<MeetingSearchService> = {}): MeetingSearchService {
  return {
    createAcceptedSearch: vi.fn().mockResolvedValue({ ok: true, value: acceptedValue }),
    getSearchById: vi.fn().mockResolvedValue({ ok: true, value: detailValue }),
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
});
