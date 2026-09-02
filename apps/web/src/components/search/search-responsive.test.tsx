/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import type { MeetingSearchDetailData, MeetingSearchResultsData } from '@railmeet/validation';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  Fraunces: () => ({ variable: '--font-display' }),
  Source_Sans_3: () => ({ variable: '--font-sans' }),
}));

import { viewport } from '@/app/layout';
import { MAP_POPUP_MAX_WIDTH } from '@/components/map/search-map';
import { PlannerWorkspace } from '@/components/planner/planner-workspace';
import { JourneyItineraryTimeline } from '@/components/search/journey-itinerary-timeline';
import { createInitialParticipants, SearchForm } from '@/components/search/search-form';
import { SearchResultsViewStandalone } from '@/components/search/search-results-view';
import { buildDraftOriginScene } from '@/lib/map-markers';
import { encodeEncodedPolyline } from '@/lib/polyline';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/components/map/search-map', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/map/search-map')>();
  return {
    ...actual,
    SearchMap: () => <div data-testid="search-map-stub" />,
  };
});

vi.mock('@/components/search/place-combobox', () => ({
  PlaceCombobox: ({
    fieldPath,
    valueText,
  }: {
    fieldPath: string;
    valueText: string;
  }) => (
    <input data-field={fieldPath} data-testid={`${fieldPath}-combobox`} value={valueText} readOnly />
  ),
}));

vi.mock('@/hooks/use-search-polling', () => ({
  useSearchPolling: vi.fn(),
}));

import { PlannerMapProvider } from '@/components/search/planner-map-context';
import { useSearchPolling } from '@/hooks/use-search-polling';
import { SearchStatusPage } from '@/components/search/search-status-page';

const mockedPolling = vi.mocked(useSearchPolling);

const berlinToMunich = encodeEncodedPolyline(
  [
    [13.4, 52.52],
    [12.0, 50.0],
    [11.58, 48.13],
  ],
  6,
);

const rankedSummary = {
  searchId: '44444444-4444-4444-8444-444444444444',
  status: 'completed',
  travelDate: '2026-06-15',
  earliestDepartureTime: '08:00',
  latestArrivalTime: '22:00',
  arrivalDayOffset: 0,
  maxJourneyDurationMinutes: 480,
  maxTransfers: 2,
  minTransferDurationMinutes: 5,
  rankingMode: 'fairest',
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
  allowedTransportModes: ['train'],
  allowedCountryCodes: [],
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
  startedAt: null,
  completedAt: '2026-06-01T12:05:00.000Z',
  failedAt: null,
  completionOutcome: 'ranked',
  failureCode: null,
  recommendedDestination: {
    placeId: 'place:munich',
    name: 'Munich',
    longitude: 11.58,
    latitude: 48.13,
  },
} as MeetingSearchDetailData;

const rankedResults = {
  searchId: rankedSummary.searchId,
  status: 'completed',
  completionOutcome: 'ranked',
  rankingMode: 'fairest',
  recommendedDestination: rankedSummary.recommendedDestination,
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
      totalTransfers: 1,
      maxTransfers: 1,
      earliestArrivalAt: '2026-06-15T10:00:00.000Z',
      latestArrivalAt: '2026-06-15T10:10:00.000Z',
      arrivalSpreadMs: 600_000,
      journeys: [
        {
          journeyId: '00000001-aaaa-4aaa-8aaa-000000000001',
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
              geometry: { points: berlinToMunich, precision: 6, length: 3 },
            },
          ],
        },
        {
          journeyId: '00000002-bbbb-4bbb-8bbb-000000000002',
          routeSummary: [{ mode: 'RAIL', displayName: 'TGV' }],
          participantId: 'p2',
          participantDisplayName: 'Blake',
          participantPosition: 1,
          origin: { placeId: 'place:paris', name: 'Paris', longitude: 2.35, latitude: 48.85 },
          destination: {
            placeId: 'place:munich',
            name: 'Munich',
            longitude: 11.58,
            latitude: 48.13,
          },
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T10:05:00.000Z',
          durationMinutes: 125,
          transfers: 0,
          transportModes: ['train'],
          legs: [
            {
              mode: 'train',
              departureAt: '2026-06-15T08:00:00.000Z',
              arrivalAt: '2026-06-15T10:05:00.000Z',
              durationMinutes: 125,
              geometry: { points: berlinToMunich, precision: 6, length: 3 },
            },
          ],
        },
      ],
    },
  ],
} as MeetingSearchResultsData;

describe('responsive layout structure', () => {
  it('exports mobile-safe viewport metadata', () => {
    expect(viewport.width).toBe('device-width');
    expect(viewport.initialScale).toBe(1);
    expect(viewport.viewportFit).toBe('cover');
  });

  it('uses a mobile-safe map popup max width', () => {
    expect(MAP_POPUP_MAX_WIDTH).toContain('100vw');
  });

  it('stacks search form schedule controls on narrow widths', () => {
    render(
      <SearchForm
        participants={createInitialParticipants()}
        onParticipantsChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('search-form')).toHaveClass('min-w-0');
    expect(screen.getByTestId('search-form-schedule')).toHaveClass('grid-cols-1', 'md:grid-cols-2');
    expect(screen.getAllByTestId('search-form-traveler-row').length).toBe(2);
  });

  it('wraps candidate metrics instead of forcing a single row', () => {
    render(<SearchResultsViewStandalone results={rankedResults} />);
    const metrics = screen.getAllByTestId('candidate-metrics')[0]!;
    expect(metrics.tagName).toBe('UL');
    expect(metrics).toHaveClass('flex', 'flex-wrap');
    expect(within(metrics).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
  });

  it('stacks journey stop rows on the narrowest breakpoint', () => {
    render(
      <JourneyItineraryTimeline
        itinerary={{
          duration: 3600,
          startTime: '2026-06-15T08:00:00.000Z',
          endTime: '2026-06-15T09:00:00.000Z',
          transfers: 0,
          legs: [
            {
              mode: 'TRAIN',
              startTime: '2026-06-15T08:00:00.000Z',
              endTime: '2026-06-15T09:00:00.000Z',
              duration: 3600,
              from: { name: 'Berlin Hauptbahnhof', lat: 52.52, lon: 13.4 },
              to: { name: 'Munich Hauptbahnhof with a very long station name', lat: 48.13, lon: 11.58 },
            },
          ],
        }}
      />,
    );
    const stopRow = screen.getAllByTestId('journey-stop-row')[0]!;
    expect(stopRow).toHaveClass('max-sm:grid-cols-1');
  });

  it('keeps the planner panel scroll region from overflowing horizontally', () => {
    render(
      <PlannerWorkspace scene={buildDraftOriginScene([])} panelTitle="Plan a meeting point" disableMap>
        <p>Panel body</p>
      </PlannerWorkspace>,
    );
    const scroll = screen.getByTestId('planner-panel-scroll');
    expect(scroll).toHaveClass('overflow-x-hidden', 'min-w-0', 'md:px-6');
  });

  it('orders completed results before the route legend and constrains legend height on mobile', () => {
    mockedPolling.mockReturnValue({
      state: {
        kind: 'completed',
        summary: rankedSummary,
        results: rankedResults,
        resultsLoading: false,
      },
      retry: vi.fn(),
    });
    render(
      <PlannerMapProvider disableMap>
        <SearchStatusPage searchId={rankedSummary.searchId} />
      </PlannerMapProvider>,
    );

    const panel = screen.getByTestId('search-completed-panel');
    const childTestIds = [...panel.children].map((child) => child.getAttribute('data-testid'));
    expect(childTestIds.indexOf('search-summary-compact')).toBeLessThan(
      childTestIds.indexOf('results-ranked'),
    );
    expect(childTestIds.indexOf('results-ranked')).toBeLessThan(
      childTestIds.indexOf('route-legend'),
    );

    const legend = screen.getByTestId('route-legend');
    expect(legend).toHaveClass('max-md:max-h-44', 'max-md:overflow-y-auto');
    expect(within(legend).getByText('Routes')).toBeInTheDocument();
  });
});
