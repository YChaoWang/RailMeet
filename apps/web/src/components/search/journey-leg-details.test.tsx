/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { MotisItineraryJson, MotisLegJson } from '@railmeet/shared';
import { getMotisModeStyle, joinInterlinedMotisLegs } from '@railmeet/shared';

import { JourneyItineraryDetails, JourneyRouteSummary } from './journey-leg-details';

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/routing/src/fixtures/transitous-manchester-york.json',
);

function manchesterYork(): MotisItineraryJson {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as MotisItineraryJson;
}

describe('JourneyItineraryDetails Manchester–York fixture', () => {
  it('shows multiple UK operators and displayName distinct from agencyName', () => {
    render(<JourneyItineraryDetails itinerary={manchesterYork()} />);
    const services = screen.getAllByTestId('journey-leg-service').map((node) => node.textContent);
    const operators = screen.getAllByTestId('journey-leg-operator').map((node) => node.textContent);
    expect(services).toEqual(expect.arrayContaining(['Yellow Line', 'TPE', 'Northern']));
    expect(operators).toEqual(
      expect.arrayContaining(['Metrolink', 'TransPennine Express', 'Northern Rail']),
    );
    expect(services).toContain('TPE');
    expect(operators).toContain('TransPennine Express');
    expect(services).not.toContain('TransPennine Express');
  });

  it('shows walking transfers with duration and distance', () => {
    render(<JourneyItineraryDetails itinerary={manchesterYork()} />);
    const walkLegs = screen.getAllByTestId('journey-leg').filter((node) => node.getAttribute('data-motis-mode') === 'WALK');
    expect(walkLegs.length).toBeGreaterThanOrEqual(2);
    expect(walkLegs.some((node) => within(node).queryByText(/188 m/))).toBe(true);
    expect(walkLegs.some((node) => within(node).queryByText(/285 m/))).toBe(true);
  });

  it('shows platforms/tracks from Place.track', () => {
    render(<JourneyItineraryDetails itinerary={manchesterYork()} />);
    expect(screen.getAllByTestId('leg-platform').map((node) => node.textContent)).toEqual(
      expect.arrayContaining(['Platform To Ashton', 'Track 4', 'Track 7']),
    );
  });

  it('expands intermediate stops with times and platforms', async () => {
    const user = userEvent.setup();
    render(<JourneyItineraryDetails itinerary={manchesterYork()} />);
    await user.click(screen.getAllByRole('button', { name: 'Show intermediate stops' })[0]!);
    const stops = screen.getByTestId('journey-leg-stops');
    expect(within(stops).getByText('Piccadilly Gardens')).toBeInTheDocument();
    expect(within(stops).getByText('Market Street')).toBeInTheDocument();
  });

  it('uses provider route colors on the service chip', () => {
    render(<JourneyItineraryDetails itinerary={manchesterYork()} />);
    const tpe = screen.getAllByTestId('journey-leg-service').find((node) => node.textContent === 'TPE');
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
    expect(screen.getByTestId('journey-route-summary')).toHaveTextContent('TPE');
    expect(screen.getByTestId('journey-route-summary')).toHaveTextContent('Northern');
  });

  it('preserves alerts from the provider payload', () => {
    render(<JourneyItineraryDetails itinerary={manchesterYork()} />);
    expect(screen.getByTestId('journey-leg-alerts')).toHaveTextContent('Special Service');
  });

  it('shows headsign/tripTo as direction and walk steps with geometry', () => {
    render(<JourneyItineraryDetails itinerary={manchesterYork()} />);
    expect(screen.getAllByTestId('journey-leg-headsign').map((node) => node.textContent)).toEqual(
      expect.arrayContaining(['Toward Bury', 'Toward Hull', 'Toward York']),
    );
    expect(screen.getAllByTestId('journey-leg-steps')[0]).toHaveTextContent('Piccadilly Station');
    const walks = screen
      .getAllByTestId('journey-leg')
      .filter((node) => node.getAttribute('data-motis-mode') === 'WALK');
    expect(walks.some((node) => node.getAttribute('data-has-geometry') === 'true')).toBe(true);
  });
});

describe('JourneyItineraryDetails Transitous behaviours', () => {
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
    render(<JourneyItineraryDetails itinerary={itinerary} />);
    expect(screen.getAllByTestId('journey-leg-service')).toHaveLength(1);
    expect(screen.getByTestId('leg-continues-as')).toHaveTextContent('Continues as LNER 2');
  });

  it('shows live and scheduled times separately when they differ', () => {
    const itinerary: MotisItineraryJson = {
      duration: 600,
      startTime: '2026-09-15T10:05:00Z',
      endTime: '2026-09-15T10:15:00Z',
      transfers: 0,
      legs: [
        {
          mode: 'REGIONAL_RAIL',
          displayName: 'Northern',
          agencyName: 'Northern Rail',
          startTime: '2026-09-15T10:05:00Z',
          scheduledStartTime: '2026-09-15T10:00:00Z',
          endTime: '2026-09-15T10:15:00Z',
          scheduledEndTime: '2026-09-15T10:12:00Z',
          duration: 600,
          realTime: true,
          from: { name: 'Leeds', tz: 'UTC' },
          to: { name: 'York', tz: 'UTC' },
        },
      ],
    };
    render(<JourneyItineraryDetails itinerary={itinerary} />);
    expect(screen.getAllByTestId('leg-time-live')[0]).toHaveTextContent('10:05');
    expect(screen.getAllByTestId('leg-time-scheduled')[0]).toHaveTextContent('10:00');
  });

  it('omits missing optional fields without placeholders', () => {
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
    render(<JourneyItineraryDetails itinerary={itinerary} />);
    expect(screen.getByTestId('journey-leg-service')).toHaveTextContent('36');
    expect(screen.queryByTestId('journey-leg-operator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('leg-platform')).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
  });

  it('never maps unknown future MOTIS modes to Train', () => {
    expect(getMotisModeStyle({ mode: 'HYPERLOOP' })[0]).toBe('other');
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
    render(<JourneyItineraryDetails itinerary={itinerary} />);
    expect(screen.getByTestId('journey-leg-service')).toHaveTextContent('Other transport');
    expect(screen.getByTestId('journey-leg-mode')).toHaveTextContent('Other transport');
    expect(screen.queryByText(/^Train$/)).not.toBeInTheDocument();
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
    render(<JourneyItineraryDetails itinerary={itinerary} />);
    expect(screen.getByTestId('journey-leg-alternatives')).toHaveTextContent('Alternative Northern 10:12');
  });
});
