import {
  PARTICIPANT_COUNT_MAX,
  PARTICIPANT_COUNT_MIN,
  RANKING_MODES,
  SEARCH_STATUSES,
  TRANSPORT_MODES,
} from './index.js';
import { describe, expect, it } from 'vitest';

describe('shared finite-value constants', () => {
  it('exposes stable ranking modes', () => {
    expect(RANKING_MODES).toEqual([
      'fairest',
      'fastest-overall',
      'fewest-transfers',
      'arrive-together',
    ]);
  });

  it('exposes provider-independent transport modes', () => {
    expect(TRANSPORT_MODES).toEqual(['train', 'bus', 'tram', 'metro', 'ferry']);
  });

  it('exposes asynchronous search statuses', () => {
    expect(SEARCH_STATUSES).toEqual([
      'queued',
      'running',
      'partially-completed',
      'completed',
      'failed',
      'cancelling',
      'cancelled',
    ]);
  });

  it('exposes Phase 8 completion outcomes and sanitized failure codes', async () => {
    const {
      SEARCH_COMPLETION_OUTCOMES,
      SEARCH_FAILURE_CODES,
      API_ERROR_CODES,
      assertSearchStatusLifecycleCoverage,
      isTerminalSearchStatus,
      shouldContinueSearchPolling,
      shouldFetchSearchResults,
    } = await import('./index.js');
    expect(SEARCH_COMPLETION_OUTCOMES).toEqual([
      'no_candidates',
      'ranked',
      'no_feasible_candidates',
    ]);
    expect(SEARCH_FAILURE_CODES).toEqual([
      'INVARIANT_VIOLATION',
      'CANDIDATE_GENERATION_FAILED',
      'ROUTING_TECHNICAL_FAILURE',
    ]);
    expect(API_ERROR_CODES).toContain('RESULTS_NOT_READY');
    expect(API_ERROR_CODES).toContain('SEARCH_FAILED');
    expect(() => assertSearchStatusLifecycleCoverage()).not.toThrow();
    expect(isTerminalSearchStatus('completed')).toBe(true);
    expect(isTerminalSearchStatus('cancelled')).toBe(true);
    expect(isTerminalSearchStatus('cancelling')).toBe(false);
    expect(shouldContinueSearchPolling('partially-completed')).toBe(true);
    expect(shouldContinueSearchPolling('cancelling')).toBe(true);
    expect(shouldFetchSearchResults('completed')).toBe(true);
    expect(shouldFetchSearchResults('partially-completed')).toBe(false);
    expect(shouldFetchSearchResults('failed')).toBe(false);
  });

  it('keeps participant bounds at 2–6', () => {
    expect(PARTICIPANT_COUNT_MIN).toBe(2);
    expect(PARTICIPANT_COUNT_MAX).toBe(6);
  });
});
