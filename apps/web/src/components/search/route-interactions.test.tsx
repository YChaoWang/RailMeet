/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchResultsViewStandalone } from '@/components/search/search-results-view';
import type { MeetingSearchResultsData } from '@railmeet/validation';
import { clearJourneyDetailCache } from '@/lib/journey-detail-cache';
import { encodeEncodedPolyline } from '@/lib/polyline';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const geometry = {
  points: encodeEncodedPolyline(
    [
      [13.4, 52.52],
      [11.58, 48.13],
    ],
    6,
  ),
  precision: 6,
  length: 2,
};

const results = {
  searchId: '44444444-4444-4444-8444-444444444444',
  status: 'completed',
  completionOutcome: 'ranked',
  rankingMode: 'fairest',
  recommendedDestination: {
    placeId: 'place:munich',
    name: 'Munich',
    longitude: 11.58,
    latitude: 48.13,
  },
  rankings: [
    {
      rankingMode: 'fairest',
      rank: 1,
      destination: {
        placeId: 'place:munich',
        name: 'Munich',
        longitude: 11.58,
        latitude: 48.13,
      },
      recommended: true,
      totalDurationMinutes: 100,
      maxDurationMinutes: 60,
      durationRangeMinutes: 10,
      totalTransfers: 0,
      maxTransfers: 0,
      earliestArrivalAt: '2026-06-15T10:00:00.000Z',
      latestArrivalAt: '2026-06-15T10:00:00.000Z',
      arrivalSpreadMs: 0,
      journeys: [
        {
          journeyId: '00000008-aaaa-4aaa-8aaa-000000000008',
          routeSummary: [{ mode: 'RAIL', displayName: 'ICE' }],
          participantId: 'p1',
          participantDisplayName: 'Alex',
          participantPosition: 0,
          origin: { placeId: 'place:berlin', name: 'Berlin', longitude: 13.4, latitude: 52.52 },
          destination: {
            placeId: 'place:munich',
            name: 'Munich',
            longitude: 11.58,
            latitude: 48.13,
          },
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T10:00:00.000Z',
          durationMinutes: 120,
          transfers: 0,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T08:00:00.000Z',
              arrivalAt: '2026-06-15T10:00:00.000Z',
              durationMinutes: 120,
              geometry,
            },
          ],
        },
      ],
    },
    {
      rankingMode: 'arrive-together',
      rank: 1,
      destination: {
        placeId: 'place:munich',
        name: 'Munich',
        longitude: 11.58,
        latitude: 48.13,
      },
      recommended: false,
      totalDurationMinutes: 110,
      maxDurationMinutes: 60,
      durationRangeMinutes: 5,
      totalTransfers: 0,
      maxTransfers: 0,
      earliestArrivalAt: '2026-06-15T10:00:00.000Z',
      latestArrivalAt: '2026-06-15T10:00:00.000Z',
      arrivalSpreadMs: 0,
      journeys: [],
    },
  ],
} as MeetingSearchResultsData;

describe('ranking interactions do not call providers', () => {
  beforeEach(() => {
    clearJourneyDetailCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/journeys/')) {
          return new Response(
            JSON.stringify({
              data: {
                journeyId: url.split('/').pop(),
                detailSource: 'legacy',
                itineraryId: null,
                providerItinerary: null,
                legs: [],
                providerItineraryUnavailableReason: null,
              },
              meta: { requestId: 'test' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('switching ranking mode does not call Transitous', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.mocked(globalThis.fetch);
    render(<SearchResultsViewStandalone results={results} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await user.click(screen.getByRole('tab', { name: 'Arrive together' }));
    expect(fetchSpy.mock.calls.every((call) => !String(call[0]).includes('transitous'))).toBe(
      true,
    );
  });

  it('selecting another candidate row does not call Transitous', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.mocked(globalThis.fetch);
    const withTwo = {
      ...results,
      rankings: [
        results.rankings[0]!,
        {
          ...results.rankings[0]!,
          rank: 2,
          recommended: false,
          destination: {
            placeId: 'place:cologne',
            name: 'Cologne',
            longitude: 6.96,
            latitude: 50.94,
          },
        },
      ],
    } as MeetingSearchResultsData;
    render(<SearchResultsViewStandalone results={withTwo} />);
    await user.click(screen.getByRole('button', { name: /Cologne/i }));
    expect(fetchSpy.mock.calls.every((call) => !String(call[0]).includes('transitous'))).toBe(
      true,
    );
  });
});
