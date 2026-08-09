/** @vitest-environment jsdom */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MapScene } from '@/lib/map-markers';
import {
  SEARCH_MAP_ORIGIN_LAYER_IDS,
  SEARCH_MAP_ORIGIN_SOURCE_ID,
  SEARCH_MAP_ROUTE_LAYER_IDS,
  SEARCH_MAP_ROUTE_SOURCE_ID,
  SEARCH_MAP_STATION_LAYER_IDS,
  SEARCH_MAP_STATION_SOURCE_ID,
  SearchMap,
} from './search-map';

type LayerSpec = { id: string; type: string; filter?: unknown; paint?: Record<string, unknown> };

const layers = new globalThis.Map<string, LayerSpec>();
const sources = new globalThis.Map<string, { data: unknown }>();
const markers: Array<{ remove: () => void }> = [];
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
  _loadHandlers: Array<() => void>;
} | null = null;

vi.mock('maplibre-gl', () => {
  class Marker {
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
    getStyle = () => ({ sources: {} });
    getContainer = () => {
      const el = document.createElement('div');
      el.appendChild(document.createElement('div'));
      return el;
    };
    getBounds = () => ({
      getWest: () => 2,
      getSouth: () => 48,
      getEast: () => 3,
      getNorth: () => 49,
    });
    getZoom = () => 4;
    getCanvas = () => ({ style: { cursor: '' } });
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
    },
    Map,
    Marker,
    Popup,
    LngLatBounds,
    AttributionControl: class {},
    NavigationControl: class {},
  };
});

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
      color: '#0f766e',
      emphasized: true,
      legIndex: 0,
      mode: 'train',
      style: 'transit',
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
      color: '#0f766e',
      emphasized: true,
      legIndex: 1,
      mode: 'walk',
      style: 'walk',
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
  legend: [{ participantId: 'p1', displayName: 'Alex', letter: 'A', color: '#0f766e' }],
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
    expect(transit?.paint?.['line-dasharray']).toBeUndefined();

    await waitFor(() => {
      expect(lastSetData?.id).toBe(SEARCH_MAP_ROUTE_SOURCE_ID);
      expect(lastSetData?.data).toMatchObject({
        type: 'FeatureCollection',
        features: [
          { id: 'route:place:munich:p1:0', properties: { style: 'transit' } },
          { id: 'route:place:munich:p1:1', properties: { style: 'walk' } },
        ],
      });
    });
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
    expect(layers.size).toBe(
      SEARCH_MAP_ROUTE_LAYER_IDS.length +
        SEARCH_MAP_ORIGIN_LAYER_IDS.length +
        SEARCH_MAP_STATION_LAYER_IDS.length,
    );
    expect(sources.size).toBe(3);
    expect(sources.has(SEARCH_MAP_ORIGIN_SOURCE_ID)).toBe(true);
    expect(sources.has(SEARCH_MAP_STATION_SOURCE_ID)).toBe(true);
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
});
