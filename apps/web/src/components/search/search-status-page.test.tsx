/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SearchPageViewState } from '@/lib/search-view-model';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/map/search-map', () => ({
  SearchMap: () => <div data-testid="search-map-stub" />,
}));

vi.mock('@/hooks/use-search-polling', () => ({
  useSearchPolling: vi.fn(),
}));

import { PlannerMapProvider } from '@/components/search/planner-map-context';
import { useSearchPolling } from '@/hooks/use-search-polling';
import { SearchStatusPage } from './search-status-page';

const mockedPolling = vi.mocked(useSearchPolling);

const summary = {
  searchId: '44444444-4444-4444-8444-444444444444',
  status: 'queued' as const,
  travelDate: '2026-06-15',
  earliestDepartureTime: '08:00',
  latestArrivalTime: '22:00',
  arrivalDayOffset: 0 as const,
  maxJourneyDurationMinutes: 480,
  maxTransfers: 2,
  minTransferDurationMinutes: 5,
  rankingMode: 'fairest' as const,
  participants: [
    {
      id: 'p1',
      displayName: 'Alex',
      origin: { placeId: 'place:berlin', name: 'Berlin', longitude: 13.4, latitude: 52.52 },
    },
    {
      id: 'p2',
      displayName: 'Blake',
      origin: { placeId: 'place:paris', name: 'Paris', longitude: 2.35, latitude: 48.85 },
    },
  ],
  allowedTransportModes: ['train' as const],
  allowedCountryCodes: [],
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
  startedAt: null,
  completedAt: null,
  failedAt: null,
  completionOutcome: null,
  failureCode: null,
  recommendedDestination: null,
};

function renderState(state: SearchPageViewState) {
  mockedPolling.mockReturnValue({ state, retry: vi.fn() });
  return render(
    <PlannerMapProvider disableMap>
      <SearchStatusPage searchId={summary.searchId} />
    </PlannerMapProvider>,
  );
}

describe('SearchStatusPage map-first surfaces', () => {
  it('keeps the planner map shell mounted across lifecycle states', () => {
    const first = renderState({ kind: 'malformed_id' });
    expect(screen.getByTestId('planner-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('planner-map-region')).toBeInTheDocument();
    expect(screen.getByText(/Invalid search link/i)).toBeInTheDocument();
    first.unmount();

    const cases: Array<{ state: SearchPageViewState; text: RegExp | string }> = [
      { state: { kind: 'not_found' }, text: /This search may no longer exist/i },
      {
        state: { kind: 'queued', summary: { ...summary, status: 'queued' } },
        text: /waiting to begin/i,
      },
      {
        state: { kind: 'running', summary: { ...summary, status: 'running' } },
        text: /Comparing journeys for 2 travelers/i,
      },
      {
        state: {
          kind: 'partially_completed',
          summary: { ...summary, status: 'partially-completed' },
        },
        text: /still working for 2 travelers/i,
      },
      {
        state: { kind: 'cancelling', summary: { ...summary, status: 'cancelling' } },
        text: /Cancellation was requested/i,
      },
      {
        state: {
          kind: 'failed',
          summary: {
            ...summary,
            status: 'failed',
            failureCode: 'ROUTING_TECHNICAL_FAILURE',
          },
        },
        text: /couldn’t complete this search/i,
      },
      {
        state: { kind: 'cancelled', summary: { ...summary, status: 'cancelled' } },
        text: /This search was cancelled/i,
      },
      {
        state: {
          kind: 'network_error',
          summary: { ...summary, status: 'queued' },
          message: 'Temporary outage',
        },
        text: /lost connection/i,
      },
      {
        state: {
          kind: 'completed',
          summary: {
            ...summary,
            status: 'completed',
            completionOutcome: 'no_candidates',
            completedAt: '2026-06-01T12:05:00.000Z',
          },
          results: {
            searchId: summary.searchId,
            status: 'completed',
            completionOutcome: 'no_candidates',
            rankingMode: 'fairest',
            recommendedDestination: null,
            rankings: [],
          },
          resultsLoading: false,
        },
        text: /couldn’t find a workable meeting plan/i,
      },
    ];

    for (const entry of cases) {
      const { unmount } = renderState(entry.state);
      expect(screen.getByTestId('planner-workspace')).toBeInTheDocument();
      expect(screen.getByTestId('planner-map-region')).toBeInTheDocument();
      expect(screen.getByText(entry.text)).toBeInTheDocument();
      if (entry.state.kind === 'network_error') {
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.getByText(/Last known status/i)).toBeInTheDocument();
      }
      unmount();
    }
  });
});
