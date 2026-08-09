/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_POLL_INTERVAL_MS, useSearchPolling } from './use-search-polling';

const SEARCH_ID = '44444444-4444-4444-8444-444444444444';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function summary(status: string, overrides: Record<string, unknown> = {}) {
  return {
    searchId: SEARCH_ID,
    status,
    travelDate: '2026-06-15',
    earliestDepartureTime: '08:00',
    latestArrivalTime: '22:00',
    arrivalDayOffset: 0,
    maxJourneyDurationMinutes: 480,
    maxTransfers: 2,
    minTransferDurationMinutes: 5,
    rankingMode: 'fairest',
    participants: [
      { id: 'p1', displayName: 'Alex', origin: { placeId: 'place:berlin', name: 'Berlin' } },
      { id: 'p2', displayName: 'Blake', origin: { placeId: 'place:paris', name: 'Paris' } },
    ],
    allowedTransportModes: ['train'],
    allowedCountryCodes: [],
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    startedAt: null,
    completedAt: null,
    failedAt: null,
    completionOutcome: null,
    failureCode: null,
    recommendedDestination: null,
    ...overrides,
  };
}

function results(outcome: 'ranked' | 'no_candidates' | 'no_feasible_candidates') {
  return {
    searchId: SEARCH_ID,
    status: 'completed',
    completionOutcome: outcome,
    rankingMode: 'fairest',
    recommendedDestination:
      outcome === 'ranked' ? { placeId: 'place:munich', name: 'Munich' } : null,
    rankings:
      outcome === 'ranked'
        ? [
            {
              rankingMode: 'fairest',
              rank: 1,
              destination: { placeId: 'place:munich', name: 'Munich' },
              recommended: true,
              totalDurationMinutes: 100,
              maxDurationMinutes: 60,
              durationRangeMinutes: 20,
              totalTransfers: 1,
              maxTransfers: 1,
              earliestArrivalAt: '2026-06-15T10:00:00.000Z',
              latestArrivalAt: '2026-06-15T10:20:00.000Z',
              arrivalSpreadMs: 1_200_000,
              journeys: [],
            },
          ]
        : [],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('useSearchPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('marks malformed IDs without polling', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSearchPolling('not-a-uuid'));
    expect(result.current.state.kind).toBe('malformed_id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('continues polling queued/running/partially-completed/cancelling without overlapping requests', async () => {
    let outstanding = 0;
    let maxOutstanding = 0;
    const queue: Array<(value: unknown) => void> = [];
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/results')) {
        throw new Error('results must not be requested for transitional statuses');
      }
      outstanding += 1;
      maxOutstanding = Math.max(maxOutstanding, outstanding);
      return new Promise((resolve) => {
        queue.push((body) => {
          outstanding -= 1;
          resolve(jsonResponse(body));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSearchPolling(SEARCH_ID));
    expect(result.current.state.kind).toBe('loading');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      queue.shift()?.({ data: summary('queued'), meta: { requestId: 'r1' } });
    });
    await flush();
    expect(result.current.state.kind).toBe('queued');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_POLL_INTERVAL_MS - 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      queue.shift()?.({ data: summary('running'), meta: { requestId: 'r2' } });
    });
    await flush();
    expect(result.current.state.kind).toBe('running');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_POLL_INTERVAL_MS);
    });
    await act(async () => {
      queue.shift()?.({ data: summary('partially-completed'), meta: { requestId: 'r3' } });
    });
    await flush();
    expect(result.current.state.kind).toBe('partially_completed');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_POLL_INTERVAL_MS);
    });
    await act(async () => {
      queue.shift()?.({ data: summary('cancelling'), meta: { requestId: 'r4' } });
    });
    await flush();
    expect(result.current.state.kind).toBe('cancelling');
    expect(maxOutstanding).toBe(1);
  });

  it('fetches results exactly once for completed ranked and empty outcomes', async () => {
    for (const outcome of ['ranked', 'no_candidates', 'no_feasible_candidates'] as const) {
      const calls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          calls.push(String(url));
          if (String(url).endsWith('/results')) {
            return Promise.resolve(
              jsonResponse({ data: results(outcome), meta: { requestId: 'rr' } }),
            );
          }
          return Promise.resolve(
            jsonResponse({
              data: summary('completed', {
                completionOutcome: outcome,
                completedAt: '2026-06-01T12:05:00.000Z',
              }),
              meta: { requestId: 'rs' },
            }),
          );
        }),
      );

      const { result, unmount } = renderHook(() => useSearchPolling(SEARCH_ID));
      await flush();
      expect(result.current.state.kind).toBe('completed');
      if (result.current.state.kind === 'completed') {
        expect(result.current.state.resultsLoading).toBe(false);
        expect(result.current.state.results?.completionOutcome).toBe(outcome);
      }
      expect(calls.filter((url) => url.endsWith('/results'))).toHaveLength(1);
      expect(calls.filter((url) => !url.endsWith('/results'))).toHaveLength(1);
      unmount();
      vi.unstubAllGlobals();
      calls.length = 0;
    }
  });

  it('stops polling and never requests rankings for failed and cancelled', async () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const fetchMock = vi.fn((url: string) => {
        if (String(url).includes('/results')) {
          throw new Error(`results must not be requested for ${status}`);
        }
        return Promise.resolve(
          jsonResponse({
            data: summary(status, {
              failureCode: status === 'failed' ? 'ROUTING_TECHNICAL_FAILURE' : null,
              failedAt: status === 'failed' ? '2026-06-01T12:05:00.000Z' : null,
            }),
            meta: { requestId: 'r' },
          }),
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      const { result, unmount } = renderHook(() => useSearchPolling(SEARCH_ID));
      await flush();
      expect(result.current.state.kind).toBe(status === 'failed' ? 'failed' : 'cancelled');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SEARCH_POLL_INTERVAL_MS * 3);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('preserves last summary on network failure and supports retry', async () => {
    let mode: 'ok' | 'network' = 'ok';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        if (mode === 'network') {
          return Promise.resolve(
            jsonResponse(
              {
                error: {
                  code: 'SERVICE_UNAVAILABLE',
                  message: 'Temporary outage',
                  requestId: 'n1',
                },
              },
              503,
            ),
          );
        }
        return Promise.resolve(
          jsonResponse({ data: summary('queued'), meta: { requestId: 'ok' } }),
        );
      }),
    );

    const { result } = renderHook(() => useSearchPolling(SEARCH_ID));
    await flush();
    expect(result.current.state.kind).toBe('queued');

    mode = 'network';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_POLL_INTERVAL_MS);
    });
    await flush();
    expect(result.current.state.kind).toBe('network_error');
    expect(
      result.current.state.kind === 'network_error' && result.current.state.summary?.status,
    ).toBe('queued');

    mode = 'ok';
    await act(async () => {
      result.current.retry();
    });
    await flush();
    expect(result.current.state.kind).toBe('queued');
  });

  it('ignores stale responses after retry generation bumps', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    );

    const { result } = renderHook(() => useSearchPolling(SEARCH_ID));
    expect(resolvers).toHaveLength(1);

    await act(async () => {
      result.current.retry();
    });
    expect(resolvers).toHaveLength(2);

    await act(async () => {
      resolvers[0]?.(
        jsonResponse({
          data: summary('running'),
          meta: { requestId: 'stale' },
        }),
      );
    });
    await flush();
    // Stale first response must not win after retry started.
    expect(result.current.state.kind).not.toBe('running');

    await act(async () => {
      resolvers[1]?.(
        jsonResponse({
          data: summary('queued'),
          meta: { requestId: 'fresh' },
        }),
      );
    });
    await flush();
    expect(result.current.state.kind).toBe('queued');
  });

  it('aborts in-flight work and clears timers on unmount', async () => {
    const abortSpies: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.signal) {
          abortSpies.push(init.signal);
        }
        return new Promise(() => {
          /* never settles */
        });
      }),
    );

    const { unmount } = renderHook(() => useSearchPolling(SEARCH_ID));
    expect(abortSpies).toHaveLength(1);
    unmount();
    expect(abortSpies[0]?.aborted).toBe(true);
  });

  it('treats not found as terminal without polling', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: { code: 'NOT_FOUND', message: 'Missing', requestId: 'r' },
        },
        404,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSearchPolling(SEARCH_ID));
    await flush();
    expect(result.current.state.kind).toBe('not_found');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_POLL_INTERVAL_MS * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
