import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildServer } from './app.js';
import { createLogger } from '@railmeet/observability';

describe('API Redis independence', () => {
  it('does not depend on BullMQ or @railmeet/queue', () => {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).not.toHaveProperty('bullmq');
    expect(pkg.dependencies).not.toHaveProperty('ioredis');
    expect(pkg.dependencies).not.toHaveProperty('@railmeet/queue');
    expect(pkg.dependencies).not.toHaveProperty('@railmeet/routing');
  });

  it('builds without a queue publisher and keeps /health working', async () => {
    const app = await buildServer({
      logger: createLogger({ name: 'api-redis-indep', level: 'silent', pretty: false }),
      meetingSearchService: {
        createAcceptedSearch: async () => ({
          ok: true,
          value: {
            searchId: '11111111-1111-4111-8111-111111111111',
            status: 'queued',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        }),
        getSearchById: async () => ({
          ok: false,
          error: { kind: 'not_found', searchId: '11111111-1111-4111-8111-111111111111' },
        }),
      },
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/meeting-searches',
      payload: {
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
      },
    });
    expect(created.statusCode).toBe(202);
    await app.close();
  });
});
