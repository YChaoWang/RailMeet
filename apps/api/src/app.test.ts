import { describe, expect, it } from 'vitest';
import { createLogger } from '@railmeet/observability';

import { buildServer, type HealthResponse } from '../src/app.js';

describe('GET /health', () => {
  it('returns a healthy status payload', async () => {
    const logger = createLogger({
      name: 'railmeet-api-test',
      level: 'silent',
      pretty: false,
    });
    const app = await buildServer({ logger });

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<HealthResponse>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('railmeet-api');
    expect(typeof body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);

    await app.close();
  });
});
