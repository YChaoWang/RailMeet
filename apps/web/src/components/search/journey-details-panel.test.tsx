/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JourneyDetailsPanel } from './journey-details-panel';
import { clearJourneyDetailCache } from '@/lib/journey-detail-cache';

const searchId = '44444444-4444-4444-8444-444444444444';
const journeyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function providerDetailBody() {
  return {
    data: {
      journeyId,
      detailSource: 'provider',
      itineraryId: 'itinerary:fixture:v1',
      providerItinerary: {
        format: 'motis-plan-itinerary-v1',
        motisPlanApiVersion: 'v5',
        motisOpenApiPin: 'motis@2.10.2:/api/v5/plan',
        itinerary: {
          duration: 3600,
          startTime: '2026-06-15T08:00:00Z',
          endTime: '2026-06-15T09:00:00Z',
          transfers: 0,
          id: 'itinerary:fixture:v1',
          legs: [
            {
              mode: 'HIGHSPEED_RAIL',
              displayName: 'ICE 100',
              agencyName: 'DB Fernverkehr AG',
              startTime: '2026-06-15T08:00:00Z',
              endTime: '2026-06-15T09:00:00Z',
              duration: 3600,
              from: { name: 'Berlin Hbf', track: '1' },
              to: { name: 'Munich Hbf', track: '12' },
              intermediateStops: [{ name: 'Erfurt Hbf', track: '3' }],
            },
          ],
        },
      },
      legs: [],
      providerItineraryUnavailableReason: null,
    },
    meta: { requestId: 'test' },
  };
}

function legacyDetailBody() {
  return {
    data: {
      journeyId,
      detailSource: 'legacy',
      itineraryId: null,
      providerItinerary: null,
      legs: [
        {
          mode: 'train',
          departureAt: '2026-06-15T08:00:00.000Z',
          arrivalAt: '2026-06-15T09:00:00.000Z',
          durationMinutes: 60,
          geometry: null,
        },
      ],
      providerItineraryUnavailableReason: null,
    },
    meta: { requestId: 'test' },
  };
}

describe('JourneyDetailsPanel', () => {
  beforeEach(() => {
    clearJourneyDetailCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows skeleton then provider UI with displayName, operator, platform and stops', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    render(<JourneyDetailsPanel searchId={searchId} journeyId={journeyId} />);
    expect(screen.getByTestId('journey-detail-skeleton')).toBeInTheDocument();
    resolveFetch!(
      new Response(JSON.stringify(providerDetailBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('journey-detail-loaded')).toBeInTheDocument());
    expect(screen.getByTestId('route-pill')).toHaveTextContent('ICE 100');
    expect(screen.getByTestId('journey-leg-operator')).toHaveTextContent('DB Fernverkehr AG');
    expect(screen.getAllByTestId('leg-platform').map((n) => n.textContent)).toEqual(
      expect.arrayContaining(['Track 1', 'Track 12']),
    );
    const user = userEvent.setup();
    const stopToggle = screen.getAllByRole('button').find((button) => /1 stop/i.test(button.textContent ?? ''));
    expect(stopToggle).toBeTruthy();
    await user.click(stopToggle!);
    expect(screen.getByTestId('journey-leg-stops')).toHaveTextContent('Erfurt Hbf');
  });

  it('renders legacy RankingJourneyLegs from detailSource, not from missing providerItinerary alone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(legacyDetailBody()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    render(<JourneyDetailsPanel searchId={searchId} journeyId={journeyId} />);
    await waitFor(() => expect(screen.getByTestId('journey-detail-loaded')).toBeInTheDocument());
    expect(screen.getByTestId('ranking-journey-legs')).toBeInTheDocument();
    expect(screen.getByTestId('route-pill')).toHaveTextContent('Rail');
  });

  it('shows retry on failure and refetches after retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r1' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(legacyDetailBody()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<JourneyDetailsPanel searchId={searchId} journeyId={journeyId} />);
    await waitFor(() => expect(screen.getByTestId('journey-detail-error')).toBeInTheDocument());
    await user.click(screen.getByTestId('journey-detail-retry'));
    await waitFor(() => expect(screen.getByTestId('journey-detail-loaded')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent loads for the same journeyId', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(legacyDetailBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<JourneyDetailsPanel searchId={searchId} journeyId={journeyId} />);
    rerender(
      <>
        <JourneyDetailsPanel searchId={searchId} journeyId={journeyId} />
        <JourneyDetailsPanel searchId={searchId} journeyId={journeyId} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId('journey-detail-loaded').length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
