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

  it('keeps participant bounds at 2–6', () => {
    expect(PARTICIPANT_COUNT_MIN).toBe(2);
    expect(PARTICIPANT_COUNT_MAX).toBe(6);
  });
});
