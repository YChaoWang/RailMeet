/** @vitest-environment jsdom */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MapScene } from '@/lib/map-markers';
import {
  SEARCH_MAP_MEETING_MARKER_COLOR,
  SEARCH_MAP_ORIGIN_LAYER_IDS,
  SEARCH_MAP_ORIGIN_SOURCE_ID,
  SEARCH_MAP_ROUTE_LAYER_IDS,
  SEARCH_MAP_ROUTE_SOURCE_ID,
  SEARCH_MAP_ROUTE_STOP_LAYER_IDS,
  SEARCH_MAP_ROUTE_STOP_SOURCE_ID,
  SEARCH_MAP_STATION_LAYER_IDS,
  SEARCH_MAP_STATION_SOURCE_ID,
  SearchMap,
  candidateMarkerStyle,
} from './search-map';

type LayerSpec = {
  id: string;
  type: string;
  filter?: unknown;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

const layers = new globalThis.Map<string, LayerSpec>();
const sources = new globalThis.Map<string, { data: unknown }>();
const markers: Array<{ remove: () => void; element?: HTMLElement | undefined }> = [];
const layerHandlers = new globalThis.Map<
  string,
  globalThis.Map<string, Array<(...args: unknown[]) => void>>
>();
let lastSetData: { id: string; data: unknown } | null = null;
let mapInstance: {
  remove: ReturnType<typeof vi.fn>;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  getLayer: (id: string) => LayerSpec | undefined;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
  isStyleLoaded: () => boolean;
  once: (event: string, cb: () => void) => void;
  on: (event: string, layerOrCb: string | (() => void), maybeCb?: () => void) => void;
  addSource: (id: string, spec: { data: unknown }) => void;
  addLayer: (spec: LayerSpec) => void;
  fitBounds: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  addControl: ReturnType<typeof vi.fn>;
  getCanvas: () => { style: { cursor: string } };
  setPaintProperty: ReturnType<typeof vi.fn>;
  setLayoutProperty: ReturnType<typeof vi.fn>;
  getStyle: () => { sources: Record<string, unknown>; layers: Array<{ id: string; type: string }> };
  getZoom: () => number;
  getTerrain: () => null;
  moveLayer: ReturnType<typeof vi.fn>;
  _loadHandlers: Array<() => void>;
} | null = null;

vi.mock('maplibre-gl', () => {
  class Marker {
    element?: HTMLElement | undefined;

    constructor(options?: { element?: HTMLElement }) {
      if (options?.element) {
        this.element = options.element;
      }
    }

    setLngLat() {
      return this;
    }
    setPopup() {
      return this;
    }
    addTo() {
      markers.push(this);
      return this;
    }
    remove() {
      const index = markers.indexOf(this);
      if (index >= 0) {
        markers.splice(index, 1);
      }
    }
  }

  class Popup {
    setText() {
      return this;
    }
    setHTML() {
      return this;
    }
  }

  class LngLatBounds {
    extend() {
      return this;
    }
  }

  class Map {
    constructor() {
      mapInstance = this as never;
      queueMicrotask(() => {
        this._loadHandlers.forEach((handler) => handler());
      });
    }
    _loadHandlers: Array<() => void> = [];
    remove = vi.fn(() => {
      layers.clear();
      sources.clear();
      layerHandlers.clear();
    });
    resize = vi.fn();
    addControl = vi.fn();
    fitBounds = vi.fn();
    easeTo = vi.fn();
    setPaintProperty = vi.fn();
    setLayoutProperty = vi.fn();
    isStyleLoaded = () => false;
    loaded = () => false;
    getContainer = () => {
      const el = document.createElement('div');
      el.appendChild(document.createElement('div'));
      return el;
    };
    getBounds = () => ({
      getWest: () => 2.2,
      getSouth: () => 48.7,
      getEast: () => 2.5,
      getNorth: () => 49.0,
    });
    getZoom = () => 11.5;
    getCanvas = () => ({ style: { cursor: '' } });
    getTerrain = () => null;
    moveLayer = vi.fn();
    hasImage = vi.fn(() => false);
    addImage = vi.fn();
    getStyle = () => ({
      sources: {},
      layers: [{ id: 'label_city', type: 'symbol' }],
    });
    queryRenderedFeatures = () => [];
    style = { _loaded: true };
    on(event: string, layerOrCb: string | (() => void), maybeCb?: () => void) {
      if (typeof layerOrCb === 'function') {
        if (event === 'load' || event === 'style.load' || event === 'styledata') {
          this._loadHandlers.push(layerOrCb);
        }
        return;
      }
      const layerId = layerOrCb;
      const handler = maybeCb!;
      if (!layerHandlers.has(layerId)) {
        layerHandlers.set(layerId, new globalThis.Map());
      }
      const byEvent = layerHandlers.get(layerId)!;
      if (!byEvent.has(event)) {
        byEvent.set(event, []);
      }
      byEvent.get(event)!.push(handler);
    }
    once(event: string, cb: () => void) {
      if (event === 'load') {
        this._loadHandlers.push(cb);
      }
    }
    addSource(id: string, spec: { data: unknown }) {
      sources.set(id, { data: spec.data });
    }
    getSource(id: string) {
      const source = sources.get(id);
      if (!source) {
        return undefined;
      }
      return {
        setData: (data: unknown) => {
          if (id === SEARCH_MAP_ROUTE_SOURCE_ID || id === SEARCH_MAP_ORIGIN_SOURCE_ID) {
            lastSetData = { id, data };
          }
          source.data = data;
        },
      };
    }
    addLayer(spec: LayerSpec) {
      layers.set(spec.id, spec);
    }
    getLayer(id: string) {
      return layers.get(id);
    }
    removeLayer(id: string) {
      layers.delete(id);
    }
    removeSource(id: string) {
      sources.delete(id);
    }
  }

  return {
    default: {
      Map,
      Marker,
      Popup,
      LngLatBounds,
      AttributionControl: class {},
      NavigationControl: class {},
      TerrainControl: class {
        onAdd() {
          const el = document.createElement('div');
          el.className = 'maplibregl-ctrl-terrain';
          return el;
        }
        onRemove() {}
      },
      setWorkerUrl: vi.fn(),
    },
    Map,
    Marker,
    Popup,
    LngLatBounds,
    AttributionControl: class {},
    NavigationControl: class {},
    TerrainControl: class {
      onAdd() {
        const el = document.createElement('div');
        el.className = 'maplibregl-ctrl-terrain';
        return el;
      }
      onRemove() {}
    },
    setWorkerUrl: vi.fn(),
  };
});

vi.mock('@/lib/map-stops-client', () => ({
  mapStopsQueryFromBounds: (
    bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number },
    zoom: number,
  ) => ({ ...bounds, zoom }),
  isMapStopsViewportEligible: (bounds: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  }) => bounds.maxLon - bounds.minLon <= 0.4 && bounds.maxLat - bounds.minLat <= 0.4,
  fetchMapStops: vi.fn(async () => ({
    ok: true,
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [2.35, 48.86] },
          properties: {
            stopId: 'stop:paris-est',
            name: 'Paris Est',
            kind: 'rail',
            importance: 'major',
            modes: ['RAIL'],
            parentId: null,
          },
        },
      ],
      metadata: {
        truncated: false,
        aggregated: false,
        minimumDetailZoom: 12,
        sourceFeatureCount: 1,
      },
    },
  })),
}));

const emptyScene: MapScene = {
  markers: [],
  routeLines: [],
  missingGeometry: [],
  legend: [],
  cameraKey: '',
};

const routeScene: MapScene = {
  markers: [
    {
      kind: 'origin',
      id: 'origin:p1',
      participantId: 'p1',
      label: 'Alex',
      letter: 'A',
      color: '#0f766e',
      longitude: 13.4,
      latitude: 52.52,
      popup: {
        participantId: 'p1',
        displayName: 'Alex',
        letter: 'A',
        color: '#0f766e',
        originLabel: 'Berlin',
        departureAt: '2026-06-15T08:00:00.000Z',
        arrivalAt: '2026-06-15T10:00:00.000Z',
        durationMinutes: 120,
        transfers: 0,
      },
    },
    {
      kind: 'candidate',
      id: 'candidate:fairest:1:place:munich',
      placeId: 'place:munich',
      label: 'Munich',
      rank: 1,
      selected: true,
      longitude: 11.58,
      latitude: 48.13,
      popup: {
        placeId: 'place:munich',
        name: 'Munich',
        rank: 1,
        earliestArrivalAt: '2026-06-15T10:00:00.000Z',
        latestArrivalAt: '2026-06-15T10:00:00.000Z',
        arrivalSpreadMs: 0,
      },
    },
  ],
  routeLines: [
    {
      id: 'route:place:munich:p1:0',
      participantId: 'p1',
      participantPosition: 0,
      letter: 'A',
      color: '#09a4ec',
      textColor: '#000000',
      colorSource: 'provider',
      emphasized: true,
      legIndex: 0,
      mode: 'train',
      motisMode: 'HIGHSPEED_RAIL',
      style: 'transit',
      serviceLabel: 'ICE 1007',
      departureAt: '2026-06-15T08:00:00.000Z',
      arrivalAt: '2026-06-15T10:00:00.000Z',
      intermediateStopCount: 0,
      coordinates: [
        [13.4, 52.52],
        [11.58, 48.13],
      ],
      popup: {
        participantId: 'p1',
        displayName: 'Alex',
        letter: 'A',
        color: '#0f766e',
        originLabel: 'Berlin',
        departureAt: '2026-06-15T08:00:00.000Z',
        arrivalAt: '2026-06-15T10:00:00.000Z',
        durationMinutes: 120,
        transfers: 0,
      },
    },
    {
      id: 'route:place:munich:p1:1',
      participantId: 'p1',
      participantPosition: 0,
      letter: 'A',
      color: '#6b7280',
      textColor: '#ffffff',
      colorSource: 'mode-fallback',
      emphasized: true,
      legIndex: 1,
      mode: 'walk',
      motisMode: 'WALK',
      style: 'walk',
      serviceLabel: 'Walk',
      departureAt: '2026-06-15T10:00:00.000Z',
      arrivalAt: '2026-06-15T10:05:00.000Z',
      intermediateStopCount: 0,
      coordinates: [
        [11.58, 48.13],
        [11.581, 48.131],
      ],
      popup: {
        participantId: 'p1',
        displayName: 'Alex',
        letter: 'A',
        color: '#0f766e',
        originLabel: 'Berlin',
        departureAt: '2026-06-15T08:00:00.000Z',
        arrivalAt: '2026-06-15T10:00:00.000Z',
        durationMinutes: 120,
        transfers: 0,
      },
    },
  ],
  missingGeometry: [],
  legend: [
    {
      participantId: 'p1',
      displayName: 'Alex',
      letter: 'A',
      color: '#0f766e',
      services: [
        {
          color: '#09a4ec',
          textColor: '#000000',
          mode: 'HIGHSPEED_RAIL',
          displayName: 'ICE 1007',
          colorSource: 'provider',
        },
      ],
    },
  ],
  cameraKey: 'route-scene-v1',
};

const emphasizedScene: MapScene = {
  ...routeScene,
  routeLines: routeScene.routeLines.map((segment) => ({ ...segment, emphasized: false })),
  cameraKey: 'route-scene-v1',
};

const switchedScene: MapScene = {
  ...routeScene,
  cameraKey: 'route-scene-v2',
  markers: [
    routeScene.markers[0]!,
    {
      kind: 'candidate',
      id: 'candidate:fairest:2:place:cologne',
      placeId: 'place:cologne',
      label: 'Cologne',
      rank: 2,
      selected: true,
      longitude: 6.96,
      latitude: 50.94,
      popup: {
        placeId: 'place:cologne',
        name: 'Cologne',
        rank: 2,
        earliestArrivalAt: '2026-06-15T12:00:00.000Z',
        latestArrivalAt: '2026-06-15T12:00:00.000Z',
        arrivalSpreadMs: 0,
      },
    },
  ],
};

const dualCandidateScene: MapScene = {
  ...routeScene,
  markers: [
    routeScene.markers[0]!,
    routeScene.markers[1]!,
    {
      kind: 'candidate',
      id: 'candidate:fairest:2:place:cologne',
      placeId: 'place:cologne',
      label: 'Cologne',
      rank: 2,
      selected: false,
      longitude: 6.96,
      latitude: 50.94,
      popup: null,
    },
  ],
};

describe('candidateMarkerStyle', () => {
  it('renders the selected meeting candidate as the largest teal circle with a white border', () => {
    const style = candidateMarkerStyle({
      kind: 'candidate',
      id: 'candidate:fairest:1:place:munich',
      placeId: 'place:munich',
      label: 'Munich',
      rank: 1,
      selected: true,
      longitude: 11.58,
      latitude: 48.13,
      popup: null,
    });
    expect(style).toContain('border-radius:999px');
    expect(style).toContain(`background:${SEARCH_MAP_MEETING_MARKER_COLOR}`);
    expect(style).toContain('border:3px solid #ffffff');
    expect(style).toContain('width:40px');
    expect(style).not.toContain('border-radius:8px');
  });

  it('keeps non-selected candidates as compact square rank pins', () => {
    const style = candidateMarkerStyle({
      kind: 'candidate',
      id: 'candidate:fairest:2:place:cologne',
      placeId: 'place:cologne',
      label: 'Cologne',
      rank: 2,
      selected: false,
      longitude: 6.96,
      latitude: 50.94,
      popup: null,
    });
    expect(style).toContain('border-radius:8px');
    expect(style).toContain('width:28px');
    expect(style).toContain('background:#152033');
    expect(style).not.toContain('border-radius:999px');
  });
});

describe('SearchMap route layers', () => {
  afterEach(() => {
    layers.clear();
    sources.clear();
    markers.length = 0;
    layerHandlers.clear();
    lastSetData = null;
    mapInstance = null;
  });

  it('creates transit and walk layers from selected route geometry only', async () => {
    render(<SearchMap scene={routeScene} />);
    await waitFor(() => {
      expect(sources.has(SEARCH_MAP_ROUTE_SOURCE_ID)).toBe(true);
    });
    for (const layerId of SEARCH_MAP_ROUTE_LAYER_IDS) {
      expect(layers.has(layerId)).toBe(true);
    }
    const walk = layers.get('railmeet-selected-routes-walk');
    const transit = layers.get('railmeet-selected-routes-transit');
    expect(walk?.paint?.['line-dasharray']).toEqual([1.2, 1.6]);
    // Walking never takes a per-feature color; transit reads the Transitous route color.
    expect(walk?.paint?.['line-color']).toBe('#6b7280');
    expect(transit?.paint?.['line-color']).toEqual(['get', 'color']);
    expect(transit?.paint?.['line-dasharray']).toBeUndefined();

    const stopLabels = layers.get('railmeet-route-stops-label');
    expect(stopLabels?.layout?.['text-allow-overlap']).toBe(true);
    expect(stopLabels?.paint?.['text-halo-color']).toEqual(['get', 'labelBackgroundColor']);
    expect(stopLabels?.paint?.['text-color']).toEqual(['get', 'textColor']);
    expect(stopLabels?.layout?.['icon-image']).toBeUndefined();

    await waitFor(() => {
      expect(lastSetData?.id).toBe(SEARCH_MAP_ROUTE_SOURCE_ID);
      expect(lastSetData?.data).toMatchObject({
        type: 'FeatureCollection',
        features: [
          {
            id: 'route:place:munich:p1:0',
            properties: {
              style: 'transit',
              color: '#09a4ec',
              colorSource: 'provider',
              serviceLabel: 'ICE 1007',
            },
          },
          { id: 'route:place:munich:p1:1', properties: { style: 'walk', color: '#6b7280' } },
        ],
      });
    });
  });

  it('renders the selected meeting candidate as a teal circle and others as square rank pins', async () => {
    render(<SearchMap scene={dualCandidateScene} />);
    await waitFor(() => {
      expect(
        markers.some((marker) => marker.element?.classList.contains('railmeet-map-marker-meeting')),
      ).toBe(true);
    });
    const meetingEl = markers.find((marker) =>
      marker.element?.classList.contains('railmeet-map-marker-meeting'),
    )?.element;
    const rankEl = markers.find((marker) =>
      marker.element?.classList.contains('railmeet-map-marker-candidate'),
    )?.element;
    expect(meetingEl?.style.borderRadius).toBe('999px');
    expect(meetingEl?.style.background).toBe('rgb(15, 118, 110)');
    expect(meetingEl?.style.border).toContain('3px solid rgb(255, 255, 255)');
    expect(meetingEl?.textContent).toBe('');
    expect(rankEl?.style.borderRadius).toBe('8px');
    expect(rankEl?.textContent).toBe('2');
  });

  it('does not duplicate layers or route click handlers after rerender', async () => {
    const view = render(<SearchMap scene={routeScene} />);
    await waitFor(() => expect(sources.has(SEARCH_MAP_ROUTE_SOURCE_ID)).toBe(true));
    const clickHandlersBefore =
      layerHandlers.get('railmeet-selected-routes-transit')?.get('click')?.length ?? 0;

    await act(async () => {
      view.rerender(<SearchMap scene={emphasizedScene} />);
    });
    await act(async () => {
      view.rerender(<SearchMap scene={routeScene} />);
    });

    expect(SEARCH_MAP_ROUTE_LAYER_IDS.every((id) => layers.has(id))).toBe(true);
    expect(SEARCH_MAP_ORIGIN_LAYER_IDS.every((id) => layers.has(id))).toBe(true);
    expect(SEARCH_MAP_STATION_LAYER_IDS.every((id) => layers.has(id))).toBe(true);
    expect(SEARCH_MAP_ROUTE_STOP_LAYER_IDS.every((id) => layers.has(id))).toBe(true);
    expect(layers.size).toBe(
      SEARCH_MAP_ROUTE_LAYER_IDS.length +
        SEARCH_MAP_ORIGIN_LAYER_IDS.length +
        SEARCH_MAP_STATION_LAYER_IDS.length +
        SEARCH_MAP_ROUTE_STOP_LAYER_IDS.length +
        1, // hillshade
    );
    expect(sources.size).toBe(5); // routes, route stops, origins, stations, terrain dem
    expect(sources.has(SEARCH_MAP_ORIGIN_SOURCE_ID)).toBe(true);
    expect(sources.has(SEARCH_MAP_STATION_SOURCE_ID)).toBe(true);
    expect(sources.has(SEARCH_MAP_ROUTE_STOP_SOURCE_ID)).toBe(true);
    const clickHandlersAfter =
      layerHandlers.get('railmeet-selected-routes-transit')?.get('click')?.length ?? 0;
    expect(clickHandlersAfter).toBe(clickHandlersBefore);
    expect(clickHandlersAfter).toBe(1);
  });

  it('fits bounds when geometry identity changes, not when only emphasis changes', async () => {
    const view = render(<SearchMap scene={routeScene} />);
    await waitFor(() => expect(mapInstance?.fitBounds).toHaveBeenCalled());
    const callsAfterFirst = mapInstance!.fitBounds.mock.calls.length;

    await act(async () => {
      view.rerender(<SearchMap scene={emphasizedScene} />);
    });
    expect(mapInstance!.fitBounds.mock.calls.length).toBe(callsAfterFirst);

    await act(async () => {
      view.rerender(<SearchMap scene={switchedScene} />);
    });
    expect(mapInstance!.fitBounds.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('clears route features when the scene has no routes', async () => {
    const view = render(<SearchMap scene={routeScene} />);
    await waitFor(() => expect(sources.has(SEARCH_MAP_ROUTE_SOURCE_ID)).toBe(true));

    await act(async () => {
      view.rerender(<SearchMap scene={emptyScene} />);
    });

    await waitFor(() => {
      expect(lastSetData).toEqual({
        id: SEARCH_MAP_ROUTE_SOURCE_ID,
        data: { type: 'FeatureCollection', features: [] },
      });
    });
    expect(SEARCH_MAP_ROUTE_LAYER_IDS.every((id) => layers.has(id))).toBe(true);
  });

  it('removes route sources and layers on unmount', async () => {
    const view = render(<SearchMap scene={routeScene} />);
    await waitFor(() => expect(sources.has(SEARCH_MAP_ROUTE_SOURCE_ID)).toBe(true));
    expect(mapInstance).not.toBeNull();

    view.unmount();
    expect(sources.has(SEARCH_MAP_ROUTE_SOURCE_ID)).toBe(false);
    for (const layerId of SEARCH_MAP_ROUTE_LAYER_IDS) {
      expect(layers.has(layerId)).toBe(false);
    }
    expect(mapInstance?.remove).toHaveBeenCalled();
  });

  it('uses a responsive map container height on the wrapper', async () => {
    const view = render(<SearchMap scene={emptyScene} />);
    expect(view.getByTestId('search-map')).toHaveClass('min-h-[12rem]', 'min-w-0');
  });
});
