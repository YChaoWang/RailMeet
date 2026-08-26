import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '@railmeet/observability';

import {
  MOTIS_PLAN_API_VERSION,
  MOTIS_REFRESH_ITINERARY_SUPPORTED,
  normalizeMotisPlanResponse,
} from './motis-normalize.js';
import { createTransitousJourneyPlanner } from './transitous-client.js';

function startMockServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(() => {
      res.statusCode = 500;
      res.end('error');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

const sampleItinerary = {
  duration: 7200,
  startTime: '2026-09-01T08:00:00Z',
  endTime: '2026-09-01T10:00:00Z',
  transfers: 1,
  legs: [
    {
      mode: 'WALK',
      startTime: '2026-09-01T08:00:00Z',
      endTime: '2026-09-01T08:10:00Z',
      duration: 600,
    },
    {
      mode: 'RAIL',
      startTime: '2026-09-01T08:15:00Z',
      endTime: '2026-09-01T09:50:00Z',
      duration: 5700,
      tripId: 'trip:1',
    },
  ],
};

describe('Transitous MOTIS plan client', () => {
  it('stays on the v5 plan pin and does not claim refresh-itinerary support', () => {
    expect(MOTIS_PLAN_API_VERSION).toBe('v5');
    expect(MOTIS_REFRESH_ITINERARY_SUPPORTED).toBe(false);
  });

  it('maps a successful plan response with User-Agent and UTC time', async () => {
    let seenUrl = '';
    let seenUa = '';
    let seenMethod = '';
    const { server, baseUrl } = await startMockServer((req, res) => {
      seenMethod = req.method ?? '';
      seenUrl = req.url ?? '';
      seenUa = req.headers['user-agent'] ?? '';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [sampleItinerary, sampleItinerary] }));
    });

    try {
      const info = vi.fn();
      const planner = createTransitousJourneyPlanner({
        baseUrl,
        userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
        timeoutMs: 5_000,
        maxResponseBytes: 1_048_576,
        logger: { ...createLogger({ name: 't', level: 'silent', pretty: false }), info },
      });
      const result = await planner.planJourney({
        origin: { latitude: 52.52, longitude: 13.405 },
        destination: { latitude: 48.8566, longitude: 2.3522 },
        departureAt: new Date('2026-09-01T07:00:00.000Z'),
      });
      expect(seenMethod).toBe('GET');
      expect(seenUrl).toContain(`/${MOTIS_PLAN_API_VERSION}/plan?`);
      expect(seenUrl).toContain('fromPlace=52.52%2C13.405');
      expect(seenUrl).toContain('toPlace=48.8566%2C2.3522');
      expect(seenUrl).toContain('time=2026-09-01T07%3A00%3A00.000Z');
      // Required for intermediateStops on transit legs.
      expect(seenUrl).toContain('detailedLegs=true');
      expect(seenUa).toBe('RailMeet/0.0.0 (+https://example.com/contact)');
      expect(result.journeys).toHaveLength(2);
      expect(result.journeys[0]?.transfers).toBe(1);
      expect(result.journeys[0]?.durationMinutes).toBe(120);
      expect(result.journeys[0]?.legs[1]?.mode).toBe('train');
      const logged = JSON.stringify(info.mock.calls);
      expect(logged).not.toMatch(/52\.52|13\.405|48\.8566/);
      expect(logged).not.toContain('itineraries');
      expect(logged).not.toContain('http://');
      expect(logged).not.toContain('fromPlace');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('accepts an empty itinerary list', async () => {
    const { server, baseUrl } = await startMockServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [] }));
    });
    try {
      const planner = createTransitousJourneyPlanner({
        baseUrl,
        userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
        timeoutMs: 5_000,
        maxResponseBytes: 1_048_576,
      });
      const result = await planner.planJourney({
        origin: { latitude: 52.52, longitude: 13.405 },
        destination: { latitude: 48.8566, longitude: 2.3522 },
        departureAt: new Date('2026-09-01T07:00:00.000Z'),
      });
      expect(result.journeys).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects invalid coordinates and invalid provider JSON', async () => {
    const planner = createTransitousJourneyPlanner({
      baseUrl: 'http://127.0.0.1:1',
      userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
      timeoutMs: 1_000,
      maxResponseBytes: 1_048_576,
    });
    await expect(
      planner.planJourney({
        origin: { latitude: 99, longitude: 13 },
        destination: { latitude: 48, longitude: 2 },
        departureAt: new Date('2026-09-01T07:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    const { server, baseUrl } = await startMockServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{not-json');
    });
    try {
      const badJson = createTransitousJourneyPlanner({
        baseUrl,
        userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
        timeoutMs: 5_000,
        maxResponseBytes: 1_048_576,
      });
      await expect(
        badJson.planJourney({
          origin: { latitude: 52.52, longitude: 13.405 },
          destination: { latitude: 48.8566, longitude: 2.3522 },
          departureAt: new Date('2026-09-01T07:00:00.000Z'),
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_CONTRACT_FAILURE' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('classifies HTTP 429/400/500 and non-JSON bodies', async () => {
    for (const [status, code, classification] of [
      [429, 'RATE_LIMITED', 'rate_limited'],
      [400, 'PROVIDER_REQUEST_FAILED', 'permanent'],
      [404, 'PROVIDER_REQUEST_FAILED', 'permanent'],
      [503, 'PROVIDER_UNAVAILABLE', 'provider_unavailable'],
      [500, 'PROVIDER_UNAVAILABLE', 'provider_unavailable'],
    ] as const) {
      const { server, baseUrl } = await startMockServer((_req, res) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'secret-provider-body', lat: 52.52 }));
      });
      try {
        const warn = vi.fn();
        const planner = createTransitousJourneyPlanner({
          baseUrl,
          userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
          timeoutMs: 5_000,
          maxResponseBytes: 1_048_576,
          logger: { ...createLogger({ name: 't', level: 'silent', pretty: false }), warn },
        });
        await expect(
          planner.planJourney({
            origin: { latitude: 52.52, longitude: 13.405 },
            destination: { latitude: 48.8566, longitude: 2.3522 },
            departureAt: new Date('2026-09-01T07:00:00.000Z'),
          }),
        ).rejects.toMatchObject({ code, classification });
        const logged = JSON.stringify(warn.mock.calls);
        expect(logged).not.toContain('secret-provider-body');
        expect(logged).not.toMatch(/52\.52|13\.405/);
        expect(logged).not.toContain('http://');
        expect(logged).not.toContain('fromPlace');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    const { server, baseUrl } = await startMockServer((_req, res) => {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain');
      res.end('nope-raw-error-body');
    });
    try {
      const warn = vi.fn();
      const planner = createTransitousJourneyPlanner({
        baseUrl,
        userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
        timeoutMs: 5_000,
        maxResponseBytes: 1_048_576,
        logger: { ...createLogger({ name: 't', level: 'silent', pretty: false }), warn },
      });
      await expect(
        planner.planJourney({
          origin: { latitude: 52.52, longitude: 13.405 },
          destination: { latitude: 48.8566, longitude: 2.3522 },
          departureAt: new Date('2026-09-01T07:00:00.000Z'),
        }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
        classification: 'provider_unavailable',
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('nope-raw-error-body');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('times out aborted requests and maps connection failures', async () => {
    const { server, baseUrl } = await startMockServer(async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [] }));
    });
    try {
      const planner = createTransitousJourneyPlanner({
        baseUrl,
        userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
        timeoutMs: 50,
        maxResponseBytes: 1_048_576,
      });
      await expect(
        planner.planJourney({
          origin: { latitude: 52.52, longitude: 13.405 },
          destination: { latitude: 48.8566, longitude: 2.3522 },
          departureAt: new Date('2026-09-01T07:00:00.000Z'),
        }),
      ).rejects.toMatchObject({ code: 'TIMEOUT', classification: 'transient' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const unreachable = createTransitousJourneyPlanner({
      baseUrl: 'http://127.0.0.1:1',
      userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
      timeoutMs: 500,
      maxResponseBytes: 1_048_576,
    });
    await expect(
      unreachable.planJourney({
        origin: { latitude: 52.52, longitude: 13.405 },
        destination: { latitude: 48.8566, longitude: 2.3522 },
        departureAt: new Date('2026-09-01T07:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_FAILURE', classification: 'transient' });
  });

  it('maps application shutdown abort distinctly from timeout', async () => {
    const { server, baseUrl } = await startMockServer(async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [] }));
    });
    try {
      const planner = createTransitousJourneyPlanner({
        baseUrl,
        userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
        timeoutMs: 5_000,
        maxResponseBytes: 1_048_576,
      });
      const controller = new AbortController();
      const pending = planner.planJourney({
        origin: { latitude: 52.52, longitude: 13.405 },
        destination: { latitude: 48.8566, longitude: 2.3522 },
        departureAt: new Date('2026-09-01T07:00:00.000Z'),
        signal: controller.signal,
      });
      controller.abort();
      await expect(pending).rejects.toMatchObject({
        code: 'SHUTDOWN',
        classification: 'shutdown',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('skips itineraries with invalid journey semantics instead of failing the whole plan', () => {
    // Per-itinerary isolation: a single inverted arrival/departure must not abort siblings.
    expect(
      normalizeMotisPlanResponse({
        itineraries: [
          {
            duration: 100,
            startTime: '2026-09-01T10:00:00Z',
            endTime: '2026-09-01T09:00:00Z',
            transfers: 0,
            legs: [
              {
                mode: 'WALK',
                startTime: '2026-09-01T10:00:00Z',
                endTime: '2026-09-01T10:05:00Z',
                duration: 300,
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('rejects valid JSON with invalid schema shape', async () => {
    const { server, baseUrl } = await startMockServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ itineraries: [{ duration: 'nope', legs: [] }] }));
    });
    try {
      const planner = createTransitousJourneyPlanner({
        baseUrl,
        userAgent: 'RailMeet/0.0.0 (+https://example.com/contact)',
        timeoutMs: 5_000,
        maxResponseBytes: 1_048_576,
      });
      await expect(
        planner.planJourney({
          origin: { latitude: 52.52, longitude: 13.405 },
          destination: { latitude: 48.8566, longitude: 2.3522 },
          departureAt: new Date('2026-09-01T07:00:00.000Z'),
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_CONTRACT_FAILURE' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('maps known MOTIS cable-car to other while preserving the precise mode token', () => {
    const journeys = normalizeMotisPlanResponse({
      itineraries: [
        {
          ...sampleItinerary,
          legs: [
            {
              mode: 'CABLE_CAR',
              startTime: '2026-09-01T08:00:00Z',
              endTime: '2026-09-01T08:05:00Z',
              duration: 300,
            },
          ],
        },
      ],
    });
    expect(journeys[0]?.legs[0]?.mode).toBe('other');
    expect(journeys[0]?.legs[0]?.motisMode).toBe('CABLE_CAR');
    expect(journeys[0]).not.toHaveProperty('itineraries');
  });
});
