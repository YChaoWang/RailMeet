/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const createMeetingSearch = vi.fn();
const planFetch = vi.fn();

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

const mapScenes: Array<{
  markers: Array<{ letter?: string; longitude: number; latitude: number; participantId?: string }>;
}> = [];

vi.mock('@/components/map/search-map', () => ({
  SearchMap: ({
    scene,
  }: {
    scene: {
      markers: Array<{
        letter?: string;
        longitude: number;
        latitude: number;
        participantId?: string;
      }>;
      routeLines: unknown[];
    };
  }) => {
    mapScenes.push({
      markers: scene.markers.map((marker) => ({
        ...(marker.letter ? { letter: marker.letter } : {}),
        longitude: marker.longitude,
        latitude: marker.latitude,
        ...(marker.participantId ? { participantId: marker.participantId } : {}),
      })),
    });
    return (
      <div
        data-testid="search-map"
        data-marker-count={scene.markers.length}
        data-route-line-count={scene.routeLines.length}
        data-applied-origin-count={scene.markers.filter((m) => 'longitude' in m).length}
      />
    );
  },
}));

import { PlannerMapProvider } from '@/components/search/planner-map-context';
import { resetTravelerIdentitySeqForTests } from '@/components/search/search-form';
import { SearchPlannerPage } from '@/components/search/search-planner-page';

function renderPlanner() {
  return render(
    <PlannerMapProvider disableMap>
      <SearchPlannerPage />
    </PlannerMapProvider>,
  );
}

describe('SearchPlannerPage real autocomplete → map boundary', () => {
  beforeEach(() => {
    push.mockReset();
    createMeetingSearch.mockReset();
    planFetch.mockReset();
    mapScenes.length = 0;
    resetTravelerIdentitySeqForTests();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/plan')) {
          planFetch();
          return new Response('{}', { status: 500 });
        }
        if (url.includes('/api/v1/places/search')) {
          return Response.json({
            data: {
              query: 'Paris',
              suggestions: [
                {
                  providerId: 'motis:paris-est',
                  name: 'Paris Est',
                  type: 'STOP',
                  latitude: 48.87698,
                  longitude: 2.35912,
                  countryCode: 'FR',
                  timezone: 'Europe/Paris',
                  modes: ['RAIL'],
                  secondaryLabel: 'Station · Paris, FR',
                },
              ],
            },
          });
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });

  it('types Paris, clicks a rendered option, and pushes marker A to SearchMap without submitting', async () => {
    const user = userEvent.setup();
    renderPlanner();

    expect(screen.getByTestId('search-map')).toHaveAttribute('data-marker-count', '0');

    const originInputs = screen.getAllByRole('combobox');
    const travelerAOrigin = originInputs[0]!;
    await user.click(travelerAOrigin);
    await user.type(travelerAOrigin, 'Paris');

    const listbox = await screen.findByRole('listbox');
    const option = await within(listbox).findByRole('option');
    expect(option).toHaveTextContent(/Paris Est/);
    await user.click(option);

    await waitFor(() => {
      expect(screen.getByTestId('search-map')).toHaveAttribute('data-marker-count', '1');
    });

    const selected = await screen.findByTestId('place-selected-hint');
    expect(selected).toHaveTextContent(/Paris Est/);
    expect(selected).toHaveTextContent(/Station/);
    expect(selected).toHaveTextContent(/Paris, FR/);
    expect(selected).toHaveTextContent(/Rail/);

    const latest = mapScenes.at(-1);
    expect(latest?.markers).toHaveLength(1);
    expect(latest?.markers[0]).toMatchObject({
      letter: 'A',
      longitude: 2.35912,
      latitude: 48.87698,
    });
    expect(typeof latest?.markers[0]?.longitude).toBe('number');
    expect(typeof latest?.markers[0]?.latitude).toBe('number');

    expect(createMeetingSearch).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(planFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId('search-map')).toHaveAttribute('data-route-line-count', '0');
  });
});
