'use client';

import type { MeetingSearchJourneyDetailData } from '@railmeet/validation';
import type { MotisItineraryJson } from '@railmeet/shared';
import { useEffect, useState } from 'react';

import {
  JourneyItineraryDetails,
  RankingJourneyLegs,
} from '@/components/search/journey-leg-details';
import {
  invalidateJourneyDetailCache,
  loadJourneyDetailCached,
  peekJourneyDetailCache,
} from '@/lib/journey-detail-cache';

type JourneyDetailsPanelProps = {
  readonly searchId: string;
  readonly journeyId: string;
};

export function JourneyDetailsSkeleton() {
  return (
    <div className="mt-2 space-y-2" data-testid="journey-detail-skeleton" aria-busy="true">
      <div className="h-4 w-2/3 animate-pulse rounded bg-mist-100" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-mist-100" />
      <div className="h-16 animate-pulse rounded bg-mist-100" />
    </div>
  );
}

function renderDetail(detail: MeetingSearchJourneyDetailData) {
  if (detail.detailSource === 'provider' && detail.providerItinerary) {
    return (
      <JourneyItineraryDetails
        itinerary={detail.providerItinerary.itinerary as MotisItineraryJson}
      />
    );
  }
  if (detail.detailSource === 'provider' && !detail.providerItinerary) {
    return (
      <div className="mt-1 space-y-2" data-testid="journey-detail-provider-unavailable">
        <p className="text-xs text-amber-800">
          Provider itinerary unavailable
          {detail.providerItineraryUnavailableReason
            ? ` (${detail.providerItineraryUnavailableReason})`
            : ''}
          . Showing ranking legs.
        </p>
        <RankingJourneyLegs legs={detail.legs} />
      </div>
    );
  }
  return <RankingJourneyLegs legs={detail.legs} />;
}

/**
 * Lazy-loads journey detail by journeyId. Compact results must not decide
 * provider vs legacy from missing providerItinerary.
 */
export function JourneyDetailsPanel({ searchId, journeyId }: JourneyDetailsPanelProps) {
  const cached = peekJourneyDetailCache(searchId, journeyId);
  const [detail, setDetail] = useState<MeetingSearchJourneyDetailData | null>(
    cached?.status === 'ready' ? cached.data : null,
  );
  const [error, setError] = useState<string | null>(
    cached?.status === 'error' ? cached.message : null,
  );
  const [loading, setLoading] = useState(cached?.status !== 'ready');
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const existing = peekJourneyDetailCache(searchId, journeyId);
    if (existing?.status === 'ready') {
      setDetail(existing.data);
      setError(null);
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    setLoading(true);
    setError(null);
    void loadJourneyDetailCached(searchId, journeyId, controller.signal)
      .then((value) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setDetail(value);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load journey details');
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [searchId, journeyId, retryToken]);

  if (loading && !detail) {
    return <JourneyDetailsSkeleton />;
  }

  if (error && !detail) {
    return (
      <div className="mt-2 space-y-2 text-xs" data-testid="journey-detail-error">
        <p className="text-amber-800">{error}</p>
        <button
          type="button"
          className="font-medium text-teal-800 underline-offset-2 hover:underline"
          data-testid="journey-detail-retry"
          onClick={() => {
            invalidateJourneyDetailCache(searchId, journeyId);
            setRetryToken((token) => token + 1);
            setLoading(true);
            setError(null);
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  return <div data-testid="journey-detail-loaded">{renderDetail(detail)}</div>;
}
