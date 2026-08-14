/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const createMeetingSearch = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/meeting-search-client', () => ({
  createMeetingSearch: (...args: unknown[]) => createMeetingSearch(...args),
}));

vi.mock('@/components/search/place-combobox', () => ({
  PlaceCombobox: ({
    fieldPath,
    valueText,
    selected,
    onTextChange,
    onSelect,
    onClearSelection,
  }: {
    fieldPath: string;
    valueText: string;
    selected: { providerId: string; name: string; latitude: number; longitude: number } | null;
    onTextChange: (text: string) => void;
    onSelect: (suggestion: unknown) => void;
    onClearSelection: () => void;
  }) => (
    <div data-testid={`combobox-${fieldPath}`}>
      <input
        data-field={fieldPath}
        role="combobox"
        aria-expanded={false}
        aria-controls={`${fieldPath}-listbox`}
        value={valueText}
        aria-label={fieldPath}
        onChange={(event) => {
          onTextChange(event.target.value);
          if (selected) {
            onClearSelection();
          }
        }}
      />
      <button
        type="button"
        data-testid={`pick-${fieldPath}`}
        onClick={() => {
          const isB = fieldPath.includes('1') || fieldPath.endsWith('1}.origin');
          // Use traveler index from field path participants.N.origin
          const match = /participants\.(\d+)\.origin/.exec(fieldPath);
          const index = match ? Number(match[1]) : 0;
          const places = [
            {
              providerId: 'motis:paris',
              name: 'Paris',
              type: 'STOP',
              latitude: 48.85,
              longitude: 2.35,
              countryCode: 'FR',
              timezone: 'Europe/Paris',
              modes: ['RAIL'],
              secondaryLabel: 'Station · FR',
            },
            {
              providerId: 'motis:brussels',
              name: 'Brussels',
              type: 'STOP',
              latitude: 50.85,
              longitude: 4.35,
              countryCode: 'BE',
              timezone: 'Europe/Brussels',
              modes: ['RAIL'],
              secondaryLabel: 'Station · BE',
            },
            {
              providerId: 'motis:amsterdam',
              name: 'Amsterdam',
              type: 'STOP',
              latitude: 52.37,
              longitude: 4.9,
              countryCode: 'NL',
              timezone: 'Europe/Amsterdam',
              modes: ['RAIL'],
              secondaryLabel: 'Station · NL',
            },
          ] as const;
          const place = places[Math.min(index, places.length - 1)]!;
          void isB;
          onSelect(place);
        }}
      >
        Pick suggestion
      </button>
      <button
        type="button"
        data-testid={`pick-alt-${fieldPath}`}
        onClick={() =>
          onSelect({
            providerId: 'motis:amsterdam',
            name: 'Amsterdam',
            type: 'STOP',
            latitude: 52.37,
            longitude: 4.9,
            countryCode: 'NL',
            timezone: 'Europe/Amsterdam',
            modes: ['RAIL'],
            secondaryLabel: 'Station · NL',
          })
        }
      >
        Pick Amsterdam
      </button>
      {selected ? (
        <span data-testid={`${fieldPath}-selected`}>
          {selected.name}:{selected.latitude}:{selected.longitude}
        </span>
      ) : null}
    </div>
  ),
  PLACE_COMBOBOX_DEBOUNCE_MS: 300,
}));

import { PlannerMapProvider } from '@/components/search/planner-map-context';
import { resetTravelerIdentitySeqForTests } from '@/components/search/search-form';
import { SearchPlannerPage } from '@/components/search/search-planner-page';

const mapScenes: Array<{ markers: Array<{ id: string; longitude: number; latitude: number }> }> =
  [];

vi.mock('@/components/map/search-map', () => ({
  SearchMap: ({
    scene,
  }: {
    scene: {
      markers: Array<{ id: string; longitude: number; latitude: number; letter?: string }>;
      routeLines: unknown[];
    };
  }) => {
    mapScenes.push({
      markers: scene.markers.map((marker) => ({
        id: marker.id,
        longitude: marker.longitude,
        latitude: marker.latitude,
      })),
    });
    return (
      <div
        data-testid="search-map"
        data-marker-count={scene.markers.length}
        data-route-line-count={scene.routeLines.length}
      />
    );
  },
}));

function renderPlanner() {
  return render(
    <PlannerMapProvider disableMap>
      <SearchPlannerPage />
    </PlannerMapProvider>,
  );
}

describe('SearchPlannerPage live draft markers', () => {
  beforeEach(() => {
    push.mockReset();
    createMeetingSearch.mockReset();
    mapScenes.length = 0;
    resetTravelerIdentitySeqForTests();
  });

  it('mounts the map before submission and adds marker A immediately on autocomplete select', async () => {
    const user = userEvent.setup();
    renderPlanner();

    expect(screen.getByTestId('planner-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('planner-map-region')).toBeInTheDocument();
    expect(screen.getByTestId('search-map')).toHaveAttribute('data-marker-count', '0');
    expect(createMeetingSearch).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('pick-participants.0.origin'));

    await waitFor(() => {
      expect(screen.getByTestId('search-map')).toHaveAttribute('data-marker-count', '1');
    });
    expect(screen.getByTestId('draft-marker-status')).toHaveTextContent('Showing 1 origin');
    expect(createMeetingSearch).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    const latest = mapScenes.at(-1);
    expect(latest?.markers).toHaveLength(1);
    expect(latest?.markers[0]).toMatchObject({
      longitude: 2.35,
      latitude: 48.85,
    });
    expect(screen.getByTestId('search-map')).toHaveAttribute('data-route-line-count', '0');
  });

  it('preserves A when selecting B, moves B on replace, clears stale A on text edit, and removes an added traveler marker', async () => {
    const user = userEvent.setup();
    renderPlanner();

    await user.click(screen.getByTestId('pick-participants.0.origin'));
    await waitFor(() =>
      expect(screen.getByTestId('search-map')).toHaveAttribute('data-marker-count', '1'),
    );

    await user.click(screen.getByTestId('pick-participants.1.origin'));
    await waitFor(() =>
      expect(screen.getByTestId('search-map')).toHaveAttribute('data-marker-count', '2'),
    );

    const withBoth = mapScenes.at(-1)?.markers ?? [];
    expect(withBoth).toHaveLength(2);
    expect(withBoth.some((marker) => marker.latitude === 48.85)).toBe(true);
    expect(withBoth.some((marker) => marker.latitude === 50.85)).toBe(true);

    await user.click(screen.getByTestId('pick-alt-participants.1.origin'));
    await waitFor(() => {
      const markers = mapScenes.at(-1)?.markers ?? [];
      expect(markers.some((marker) => marker.latitude === 52.37)).toBe(true);
      expect(markers.some((marker) => marker.latitude === 50.85)).toBe(false);
      expect(markers).toHaveLength(2);
    });

    const travelerAInput = screen.getByLabelText('participants.0.origin');
    await user.type(travelerAInput, 'x');
    await waitFor(() =>
      expect(screen.getByTestId('search-map')).toHaveAttribute('data-marker-count', '1'),
    );
    expect(mapScenes.at(-1)?.markers.every((marker) => marker.latitude !== 48.85)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Add traveler' }));
    await user.click(screen.getByTestId('pick-participants.2.origin'));
    await waitFor(() =>
      expect(screen.getByTestId('search-map')).toHaveAttribute('data-marker-count', '2'),
    );

    await user.click(screen.getByRole('button', { name: 'Remove last' }));
    await waitFor(() =>
      expect(screen.getByTestId('search-map')).toHaveAttribute('data-marker-count', '1'),
    );
    expect(mapScenes.at(-1)?.markers).toHaveLength(1);
    expect(mapScenes.at(-1)?.markers[0]?.latitude).toBe(52.37);

    expect(createMeetingSearch).not.toHaveBeenCalled();
  });

  it('does not create a marker for an empty added traveler', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByRole('button', { name: 'Add traveler' }));
    expect(screen.getByTestId('search-map')).toHaveAttribute('data-marker-count', '0');
    expect(createMeetingSearch).not.toHaveBeenCalled();
  });

  it('keeps stable traveler letters when removing another traveler', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByRole('button', { name: 'Add traveler' }));
    expect(screen.getByPlaceholderText('Name (optional — defaults to Traveler C)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove last' }));
    expect(
      screen.queryByPlaceholderText('Name (optional — defaults to Traveler C)'),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Name (optional — defaults to Traveler A)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Name (optional — defaults to Traveler B)')).toBeInTheDocument();
  });
});
