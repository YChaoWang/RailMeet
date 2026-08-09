'use client';

import { useEffect, useRef, useState } from 'react';
import type { MeetingSearchDetailData, MeetingSearchResultsData } from '@railmeet/validation';

import { fetchMeetingSearch, fetchMeetingSearchResults } from '@/lib/meeting-search-client';
import { decideSummaryPollAction, isUuid, type SearchPageViewState } from '@/lib/search-view-model';

export const SEARCH_POLL_INTERVAL_MS = 2000;

export function useSearchPolling(searchId: string): {
  readonly state: SearchPageViewState;
  readonly retry: () => void;
} {
  const [state, setState] = useState<SearchPageViewState>(() =>
    isUuid(searchId) ? { kind: 'loading' } : { kind: 'malformed_id' },
  );
  const [retryToken, setRetryToken] = useState(0);
  const summaryRef = useRef<MeetingSearchDetailData | null>(null);
  const resultsFetchedRef = useRef(false);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    if (!isUuid(searchId)) {
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    resultsFetchedRef.current = false;
    const generation = ++requestGenerationRef.current;

    const schedule = (delayMs: number) => {
      timer = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const isStale = () => disposed || generation !== requestGenerationRef.current;

    const loadResults = async (summary: MeetingSearchDetailData) => {
      if (resultsFetchedRef.current) {
        return;
      }
      resultsFetchedRef.current = true;
      setState({
        kind: 'completed',
        summary,
        results: null,
        resultsLoading: true,
      });
      const result = await fetchMeetingSearchResults(searchId, abort.signal);
      if (isStale()) {
        return;
      }
      if (!result.ok) {
        setState({
          kind: 'network_error',
          summary,
          message: result.error.message,
        });
        return;
      }
      setState({
        kind: 'completed',
        summary,
        results: result.data,
        resultsLoading: false,
      });
    };

    const applySummary = async (summary: MeetingSearchDetailData) => {
      summaryRef.current = summary;
      const decision = decideSummaryPollAction(summary.status);
      switch (decision.action) {
        case 'poll':
          setState({ kind: decision.viewKind, summary });
          schedule(SEARCH_POLL_INTERVAL_MS);
          return;
        case 'fetch_results':
          await loadResults(summary);
          return;
        case 'stop_failed':
          setState({ kind: 'failed', summary });
          return;
        case 'stop_cancelled':
          setState({ kind: 'cancelled', summary });
          return;
        default: {
          const _exhaustive: never = decision;
          return _exhaustive;
        }
      }
    };

    const tick = async () => {
      try {
        const result = await fetchMeetingSearch(searchId, abort.signal);
        if (isStale()) {
          return;
        }
        if (!result.ok) {
          if (result.status === 404) {
            setState({ kind: 'not_found' });
            return;
          }
          setState({
            kind: 'network_error',
            summary: summaryRef.current,
            message: result.error.message,
          });
          return;
        }
        await applySummary(result.data);
      } catch (error) {
        if (isStale() || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }
        setState({
          kind: 'network_error',
          summary: summaryRef.current,
          message: 'We lost connection while checking the search.',
        });
      }
    };

    void tick();

    return () => {
      disposed = true;
      abort.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [searchId, retryToken]);

  return {
    state,
    retry: () => setRetryToken((value) => value + 1),
  };
}

export type { MeetingSearchResultsData };
