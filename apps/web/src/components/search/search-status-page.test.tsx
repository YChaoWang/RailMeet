/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SearchPageViewState } from '@/lib/search-view-model';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
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
  it('keeps the planner map shell mounted across lifecycle states', async () => {
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
      expect(await screen.findByText(entry.text, undefined, { timeout: 4000 })).toBeInTheDocument();
      if (entry.state.kind === 'network_error') {
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.getByText(/Last known status/i)).toBeInTheDocument();
      }
      unmount();
    }
  });

  it('keeps completed results in the panel without a New search header control', () => {
    renderState({
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
    });

    expect(screen.queryByTestId('new-search-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inline-new-search')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^New search$/ })).not.toBeInTheDocument();
    expect(screen.getByText(/couldn’t find a workable meeting plan/i)).toBeInTheDocument();
    expect(screen.getByTestId('planner-map-region')).toBeInTheDocument();
  });

  it('reveals determining-route progress one thought at a time', async () => {
    const user = userEvent.setup();
    renderState({ kind: 'running', summary: { ...summary, status: 'running' } });

    const conversation = screen.getByRole('log', { name: 'Search conversation' });
    expect(conversation).toBeInTheDocument();
    expect(conversation).toHaveTextContent('RailMeet');
    expect(conversation).toHaveTextContent('I’m determining routes for 2 travelers');
    const progress = screen.getByTestId('search-route-progress');
    expect(progress).toHaveAttribute('aria-busy', 'true');
    const trigger = screen.getByRole('button', { name: /Determining routes/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger.querySelector('.chain-of-thought__streaming-text')).toHaveTextContent(
      'Determining routes',
    );
    expect(screen.queryByText('Accepted')).not.toBeInTheDocument();
    expect(screen.queryByText('Determine routes')).not.toBeInTheDocument();
    expect(screen.queryByText('Show ranked meeting cities')).not.toBeInTheDocument();

    expect(await screen.findByText('Accepted', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText('Determine routes')).not.toBeInTheDocument();

    expect(await screen.findByText('Determine routes', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(
      document.querySelector('.chain-of-thought__step-label.chain-of-thought__streaming-text'),
    ).toHaveTextContent('Determine routes');
    expect(await screen.findByText(/Comparing journeys for 2 travelers/i)).toBeInTheDocument();
    expect(await screen.findByText(/Determine route for Alex from Berlin/, undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(
      await screen.findByText(/Determine route for Blake from Paris/, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Show ranked meeting cities', undefined, { timeout: 2000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Determining routes/i }));
    expect(screen.getByRole('button', { name: /Determining routes/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
