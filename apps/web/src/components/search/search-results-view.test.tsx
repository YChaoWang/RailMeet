/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeetingSearchResultsData } from '@railmeet/validation';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SearchResultsViewStandalone } from './search-results-view';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const rankedResults = {
  searchId: '44444444-4444-4444-8444-444444444444',
  status: 'completed',
  completionOutcome: 'ranked',
  rankingMode: 'fairest',
  recommendedDestination: {
    placeId: 'place:munich',
    name: 'Munich',
    longitude: 11.582,
    latitude: 48.1351,
  },
  rankings: [
    {
      rankingMode: 'fairest',
      rank: 2,
      destination: {
        placeId: 'place:cologne',
        name: 'Cologne',
        longitude: 6.96,
        latitude: 50.94,
      },
      recommended: false,
      totalDurationMinutes: 200,
      maxDurationMinutes: 100,
      durationRangeMinutes: 40,
      totalTransfers: 4,
      maxTransfers: 2,
      earliestArrivalAt: '2026-06-15T11:00:00.000Z',
      latestArrivalAt: '2026-06-15T11:40:00.000Z',
      arrivalSpreadMs: 2_400_000,
      journeys: [
        {
          participantId: 'b',
          participantDisplayName: 'Blake',
          participantPosition: 1,
          origin: { placeId: 'place:paris', name: 'Paris', longitude: 2.35, latitude: 48.85 },
          destination: {
            placeId: 'place:cologne',
            name: 'Cologne',
            longitude: 6.96,
            latitude: 50.94,
          },
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T11:40:00.000Z',
          durationMinutes: 100,
          transfers: 2,
          transportModes: ['train'],
          legs: [],
        },
        {
          participantId: 'a',
          participantDisplayName: 'Alex',
          participantPosition: 0,
          origin: { placeId: 'place:berlin', name: 'Berlin', longitude: 13.4, latitude: 52.52 },
          destination: {
            placeId: 'place:cologne',
            name: 'Cologne',
            longitude: 6.96,
            latitude: 50.94,
          },
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T11:00:00.000Z',
          durationMinutes: 100,
          transfers: 2,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T08:00:00.000Z',
              arrivalAt: '2026-06-15T11:00:00.000Z',
              durationMinutes: 100,
              geometry: null,
            },
          ],
        },
      ],
    },
    {
      rankingMode: 'fairest',
      rank: 1,
      destination: {
        placeId: 'place:munich',
        name: 'Munich',
        longitude: 11.582,
        latitude: 48.1351,
      },
      recommended: true,
      totalDurationMinutes: 120,
      maxDurationMinutes: 70,
      durationRangeMinutes: 10,
      totalTransfers: 1,
      maxTransfers: 1,
      earliestArrivalAt: '2026-06-15T10:00:00.000Z',
      latestArrivalAt: '2026-06-15T10:10:00.000Z',
      arrivalSpreadMs: 600_000,
      journeys: [
        {
          participantId: 'a',
          participantDisplayName: 'Alex',
          participantPosition: 0,
          origin: { placeId: 'place:berlin', name: 'Berlin', longitude: 13.4, latitude: 52.52 },
          destination: {
            placeId: 'place:munich',
            name: 'Munich',
            longitude: 11.582,
            latitude: 48.1351,
          },
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T10:00:00.000Z',
          durationMinutes: 60,
          transfers: 0,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T08:00:00.000Z',
              arrivalAt: '2026-06-15T10:00:00.000Z',
              durationMinutes: 60,
              geometry: null,
            },
          ],
        },
        {
          participantId: 'b',
          participantDisplayName: 'Blake',
          participantPosition: 1,
          origin: { placeId: 'place:paris', name: 'Paris', longitude: 2.35, latitude: 48.85 },
          destination: {
            placeId: 'place:munich',
            name: 'Munich',
            longitude: 11.582,
            latitude: 48.1351,
          },
          departureAt: '2026-06-15T08:10:00.000Z',
          arrivalAt: '2026-06-15T10:10:00.000Z',
          durationMinutes: 60,
          transfers: 1,
          transportModes: ['train'],
          legs: [],
        },
      ],
    },
    {
      rankingMode: 'fastest-overall',
      rank: 1,
      destination: {
        placeId: 'place:munich',
        name: 'Munich',
        longitude: 11.582,
        latitude: 48.1351,
      },
      recommended: false,
      totalDurationMinutes: 110,
      maxDurationMinutes: 60,
      durationRangeMinutes: 5,
      totalTransfers: 1,
      maxTransfers: 1,
      earliestArrivalAt: '2026-06-15T09:50:00.000Z',
      latestArrivalAt: '2026-06-15T09:55:00.000Z',
      arrivalSpreadMs: 300_000,
      journeys: [],
    },
    {
      rankingMode: 'fewest-transfers',
      rank: 1,
      destination: {
        placeId: 'place:munich',
        name: 'Munich',
        longitude: 11.582,
        latitude: 48.1351,
      },
      recommended: false,
      totalDurationMinutes: 130,
      maxDurationMinutes: 70,
      durationRangeMinutes: 10,
      totalTransfers: 0,
      maxTransfers: 0,
      earliestArrivalAt: '2026-06-15T10:00:00.000Z',
      latestArrivalAt: '2026-06-15T10:05:00.000Z',
      arrivalSpreadMs: 300_000,
      journeys: [],
    },
    {
      rankingMode: 'arrive-together',
      rank: 1,
      destination: {
        placeId: 'place:munich',
        name: 'Munich',
        longitude: 11.582,
        latitude: 48.1351,
      },
      recommended: false,
      totalDurationMinutes: 140,
      maxDurationMinutes: 80,
      durationRangeMinutes: 2,
      totalTransfers: 2,
      maxTransfers: 1,
      earliestArrivalAt: '2026-06-15T10:00:00.000Z',
      latestArrivalAt: '2026-06-15T10:02:00.000Z',
      arrivalSpreadMs: 120_000,
      journeys: [],
    },
  ],
} as MeetingSearchResultsData;

describe('SearchResultsView', () => {
  it('renders all four modes and preserves intentionally shuffled server order', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<SearchResultsViewStandalone results={rankedResults} />);
    expect(screen.getByRole('tab', { name: 'Fairest' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Fastest overall' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Fewest transfers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Arrive together' })).toBeInTheDocument();

    const ranked = screen.getByTestId('results-ranked');
    const candidateButtons = within(ranked).getAllByRole('button', { name: /Rank /i });
    expect(candidateButtons[0]).toHaveTextContent('Rank 2');
    expect(candidateButtons[0]).toHaveTextContent('Cologne');
    expect(candidateButtons[1]).toHaveTextContent('Rank 1');
    expect(candidateButtons[1]).toHaveTextContent('Munich');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not invent legs when absent and shows empty outcomes without failure styling', () => {
    render(<SearchResultsViewStandalone results={rankedResults} />);
    expect(screen.queryByText(/intermediate stop/i)).not.toBeInTheDocument();

    for (const outcome of ['no_candidates', 'no_feasible_candidates'] as const) {
      const { unmount } = render(
        <SearchResultsViewStandalone
          results={{
            ...rankedResults,
            completionOutcome: outcome,
            recommendedDestination: null,
            rankings: [],
          }}
        />,
      );
      expect(screen.getByText('We couldn’t find a workable meeting plan.')).toBeInTheDocument();
      expect(screen.queryByText(/couldn’t complete this search/i)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('selecting a candidate updates selection state without creating a new search', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<SearchResultsViewStandalone results={rankedResults} />);
    const cologne = screen.getByRole('button', { name: /Rank 2[\s\S]*Cologne/i });
    await user.click(cologne);
    expect(cologne).toHaveAttribute('aria-pressed', 'true');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('switching ranking mode selects that mode’s rank-1 candidate without fetching', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<SearchResultsViewStandalone results={rankedResults} />);
    await user.click(screen.getByRole('tab', { name: 'Fastest overall' }));
    const munich = screen.getByRole('button', { name: /Rank 1[\s\S]*Munich/i });
    expect(munich).toHaveAttribute('aria-pressed', 'true');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
