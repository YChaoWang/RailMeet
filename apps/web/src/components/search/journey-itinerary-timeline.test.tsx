/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { MotisItineraryJson, MotisLegJson } from '@railmeet/shared';
import { joinInterlinedMotisLegs } from '@railmeet/shared';

import { JourneyItineraryTimeline, JourneyRouteSummary } from './journey-itinerary-timeline';

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/routing/src/fixtures',
);

function manchesterYork(): MotisItineraryJson {
  return JSON.parse(readFileSync(resolve(fixtureDir, 'transitous-manchester-york.json'), 'utf8')) as MotisItineraryJson;
}

function berlinYork(): MotisItineraryJson {
  return JSON.parse(readFileSync(resolve(fixtureDir, 'transitous-berlin-york.json'), 'utf8')) as MotisItineraryJson;
}

describe('JourneyItineraryTimeline Manchester–York fixture', () => {
  it('shows multiple UK operators and displayName distinct from agencyName', () => {
    render(<JourneyItineraryTimeline itinerary={manchesterYork()} />);
    const overview = screen.getByTestId('journey-overview-header');
    expect(overview).toHaveTextContent('Yellow Line');
    expect(overview).toHaveTextContent('TPE');
    expect(overview).toHaveTextContent('Northern');
    expect(screen.getAllByTestId('journey-leg-operator').map((node) => node.textContent)).toEqual(
      expect.arrayContaining(['Metrolink', 'TransPennine Express', 'Northern Rail']),
    );
  });

  it('shows walking transfers with duration and distance', () => {
    render(<JourneyItineraryTimeline itinerary={manchesterYork()} />);
    const walks = screen.getAllByTestId('journey-walk');
    expect(walks.length).toBeGreaterThanOrEqual(2);
    expect(walks.some((node) => within(node).queryByText(/188 m/))).toBe(true);
  });

  it('shows platforms/tracks from Place.track', () => {
    render(<JourneyItineraryTimeline itinerary={manchesterYork()} />);
    expect(screen.getAllByTestId('leg-platform').map((node) => node.textContent)).toEqual(
      expect.arrayContaining(['Platform To Ashton', 'Track 4']),
    );
  });

  it('expands intermediate stops with times and platforms', async () => {
    const user = userEvent.setup();
    render(<JourneyItineraryTimeline itinerary={manchesterYork()} />);
    const stopToggle = screen.getAllByRole('button').find((button) => /intermediate stops|1 stop|2 stops|3 stops/i.test(button.textContent ?? ''));
    expect(stopToggle).toBeTruthy();
    await user.click(stopToggle!);
    const stops = screen.getByTestId('journey-leg-stops');
    expect(within(stops).getByText('Piccadilly Gardens')).toBeInTheDocument();
  });

  it('uses provider route colors on route pills', () => {
    render(<JourneyItineraryTimeline itinerary={manchesterYork()} />);
    const tpe = screen.getAllByTestId('route-pill').find((node) => node.textContent?.includes('TPE'));
    expect(tpe?.getAttribute('style')).toContain('rgb(9, 164, 236)');
  });

  it('renders route summary chips from compact segments', () => {
    render(
      <JourneyRouteSummary
        segments={[
          { mode: 'TRAM', displayName: 'Yellow Line', routeColor: '#efbb00', routeTextColor: '#000000' },
          { mode: 'REGIONAL_RAIL', displayName: 'TPE', routeColor: '#09a4ec' },
          { mode: 'REGIONAL_RAIL', displayName: 'Northern', routeColor: '#0f0d78' },
        ]}
      />,
    );
    expect(screen.getByTestId('journey-route-summary')).toHaveTextContent('Yellow Line');
  });

  it('preserves alerts from the provider payload', async () => {
    const user = userEvent.setup();
    render(<JourneyItineraryTimeline itinerary={manchesterYork()} />);
    await user.click(screen.getByRole('button', { name: /Special Service/i }));
    expect(screen.getByTestId('journey-leg-alerts')).toHaveTextContent('Special Service');
  });

  it('shows headsign and walking directions disclosure', async () => {
    const user = userEvent.setup();
    render(<JourneyItineraryTimeline itinerary={manchesterYork()} />);
    expect(screen.getAllByTestId('journey-leg-headsign').map((node) => node.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Toward Bury/), expect.stringMatching(/Toward York/)]),
    );
    await user.click(screen.getByRole('button', { name: /Show walking directions/i }));
    expect(screen.getByTestId('journey-leg-steps')).toHaveTextContent('Piccadilly Station');
  });
});

describe('JourneyItineraryTimeline Berlin → York fixture', () => {
  it('renders participant context and overnight header for Berlin → York', () => {
    render(
      <JourneyItineraryTimeline
        itinerary={berlinYork()}
        context={{
          participantDisplayName: 'David',
          originLabel: 'Berlin Hbf',
          destinationLabel: 'York',
        }}
      />,
    );
    const header = screen.getByTestId('journey-overview-header');
    expect(header).toHaveTextContent("David's journey");
    expect(header).toHaveTextContent('Berlin Hbf → York');
    expect(header).toHaveTextContent('+1 day');
    expect(screen.getAllByTestId('route-pill').length).toBeGreaterThanOrEqual(7);
  });
});

describe('JourneyItineraryTimeline Transitous behaviours', () => {
  it('joins interlined legs and shows Continues as instead of a transfer', () => {
    const itinerary: MotisItineraryJson = {
      duration: 3600,
      startTime: '2026-09-15T10:00:00Z',
      endTime: '2026-09-15T11:00:00Z',
      transfers: 0,
      legs: [
        {
          mode: 'LONG_DISTANCE',
          displayName: 'LNER',
          agencyName: 'LNER',
          startTime: '2026-09-15T10:00:00Z',
          endTime: '2026-09-15T10:30:00Z',
          scheduledStartTime: '2026-09-15T10:00:00Z',
          scheduledEndTime: '2026-09-15T10:30:00Z',
          duration: 1800,
          from: { name: 'York', track: '5', tz: 'UTC' },
          to: { name: 'Doncaster', track: '4', tz: 'UTC' },
          intermediateStops: [],
          interlineWithPreviousLeg: false,
        },
        {
          mode: 'LONG_DISTANCE',
          displayName: 'LNER 2',
          agencyName: 'LNER',
          startTime: '2026-09-15T10:30:00Z',
          endTime: '2026-09-15T11:00:00Z',
          duration: 1800,
          from: { name: 'Doncaster', track: '4', tz: 'UTC' },
          to: { name: 'London Kings Cross', track: '1', tz: 'UTC' },
          intermediateStops: [],
          interlineWithPreviousLeg: true,
        },
      ],
    };
    expect(joinInterlinedMotisLegs(itinerary.legs)).toHaveLength(1);
    render(<JourneyItineraryTimeline itinerary={itinerary} />);
    expect(screen.getAllByTestId('route-pill')).toHaveLength(1);
    expect(screen.getByTestId('leg-continues-as')).toHaveTextContent('Continues as LNER 2');
  });

  it('joins interlined legs and shows Continues as instead of a transfer', () => {
    const itinerary: MotisItineraryJson = {
      duration: 600,
      startTime: '2026-09-15T10:00:00Z',
      endTime: '2026-09-15T10:10:00Z',
      transfers: 0,
      legs: [
        {
          mode: 'BUS',
          displayName: '36',
          startTime: '2026-09-15T10:00:00Z',
          endTime: '2026-09-15T10:10:00Z',
          duration: 600,
          from: { name: 'York Station' },
          to: { name: 'York Museum' },
        },
      ],
    };
    render(<JourneyItineraryTimeline itinerary={itinerary} />);
    expect(screen.getByTestId('route-pill')).toHaveTextContent('36');
    expect(screen.queryByTestId('journey-leg-operator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('leg-platform')).not.toBeInTheDocument();
  });

  it('never maps unknown future MOTIS modes to Train', () => {
    const itinerary: MotisItineraryJson = {
      duration: 60,
      startTime: '2026-09-15T10:00:00Z',
      endTime: '2026-09-15T10:01:00Z',
      transfers: 0,
      legs: [
        {
          mode: 'HYPERLOOP',
          startTime: '2026-09-15T10:00:00Z',
          endTime: '2026-09-15T10:01:00Z',
          duration: 60,
          from: { name: 'A' },
          to: { name: 'B' },
        } satisfies MotisLegJson,
      ],
    };
    render(<JourneyItineraryTimeline itinerary={itinerary} />);
    expect(screen.getByTestId('route-pill')).toHaveTextContent('Other transport');
  });

  it('preserves leg alternatives when MOTIS included them', () => {
    const itinerary: MotisItineraryJson = {
      duration: 600,
      startTime: '2026-09-15T10:00:00Z',
      endTime: '2026-09-15T10:10:00Z',
      transfers: 0,
      legs: [
        {
          mode: 'REGIONAL_RAIL',
          displayName: 'TPE',
          startTime: '2026-09-15T10:00:00Z',
          endTime: '2026-09-15T10:10:00Z',
          duration: 600,
          from: { name: 'Leeds', tz: 'UTC' },
          to: { name: 'York', tz: 'UTC' },
          alternatives: [
            [
              {
                mode: 'REGIONAL_RAIL',
                displayName: 'Northern',
                startTime: '2026-09-15T10:12:00Z',
                endTime: '2026-09-15T10:40:00Z',
                duration: 1680,
                from: { name: 'Leeds', tz: 'UTC' },
              },
            ],
          ],
        },
      ],
    };
    render(<JourneyItineraryTimeline itinerary={itinerary} />);
    expect(screen.getByTestId('journey-leg-alternatives')).toHaveTextContent('Northern');
    expect(screen.getByTestId('journey-leg-alternatives')).toHaveTextContent('informational');
  });
});
