import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@railmeet/observability';
import type { Database } from '@railmeet/database';
import type { MeetingSearchService } from '../src/services/meeting-search-service.js';

import { buildServer, type HealthResponse } from '../src/app.js';

const silentLogger = () =>
  createLogger({ name: 'railmeet-api-test', level: 'silent', pretty: false });

describe('GET /health', () => {
  it('returns a healthy status payload with release identity', async () => {
    const app = await buildServer({ logger: silentLogger() });

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<HealthResponse>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('railmeet-api');
    expect(typeof body.version).toBe('string');
    expect(typeof body.gitSha).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);

    await app.close();
  });
});

describe('GET /ready', () => {
  it('returns 503 when database is unavailable', async () => {
    const app = await buildServer({ logger: silentLogger() });

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('unavailable');
    expect(body.reason).toBe('database_unavailable');
    expect(body).not.toHaveProperty('connectionString');
    expect(body).not.toHaveProperty('databaseUrl');

    await app.close();
  });

  const noopMeetingSearchService: MeetingSearchService = {
    async createAcceptedSearch() {
      throw new Error('not used in readiness tests');
    },
    async getSearchById() {
      throw new Error('not used in readiness tests');
    },
    async getSearchResults() {
      throw new Error('not used in readiness tests');
    },
    async getJourneyDetail() {
      throw new Error('not used in readiness tests');
    },
  };

  function fakeDatabase(pingImpl: () => Promise<void>): Database {
    return {
      ping: pingImpl,
      close: async () => {},
      // Route tests here never touch repository methods.
      db: {} as Database['db'],
      places: {} as Database['places'],
      meetingSearches: {} as Database['meetingSearches'],
      outbox: {} as Database['outbox'],
      searchPipeline: {} as Database['searchPipeline'],
      finalization: {} as Database['finalization'],
      migrate: async () => {},
    };
  }

  it('returns 200 when dependency ping succeeds', async () => {
    const database = fakeDatabase(async () => {});
    const app = await buildServer({
      logger: silentLogger(),
      database,
      meetingSearchService: noopMeetingSearchService,
    });

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ready');
    expect(body.service).toBe('railmeet-api');

    await app.close();
  });

  it('returns 503 when dependency ping rejects', async () => {
    const database = fakeDatabase(async () => {
      throw new Error('db down');
    });
    const app = await buildServer({
      logger: silentLogger(),
      database,
      meetingSearchService: noopMeetingSearchService,
    });

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      reason: 'database_unavailable',
    });

    await app.close();
  });

  it('returns 503 when dependency ping times out', async () => {
    const database = fakeDatabase(async () => new Promise(() => undefined));
    const app = await buildServer({
      logger: silentLogger(),
      database,
      meetingSearchService: noopMeetingSearchService,
      readinessProbeTimeoutMs: 20,
      readinessCacheTtlMs: 0,
    });

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      reason: 'database_unavailable',
    });

    await app.close();
  });

  it('caches readiness result to avoid probing on every request', async () => {
    const ping = vi.fn(async () => {});
    const database = fakeDatabase(ping);
    const app = await buildServer({
      logger: silentLogger(),
      database,
      meetingSearchService: noopMeetingSearchService,
      readinessProbeTimeoutMs: 100,
      readinessCacheTtlMs: 10_000,
    });

    const first = await app.inject({ method: 'GET', url: '/ready' });
    const second = await app.inject({ method: 'GET', url: '/ready' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(ping).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
