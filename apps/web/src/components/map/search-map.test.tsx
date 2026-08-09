/** @vitest-environment jsdom */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MapScene } from '@/lib/map-markers';
import { SEARCH_MAP_ROUTE_LAYER_IDS, SEARCH_MAP_ROUTE_SOURCE_ID, SearchMap } from './search-map';

type LayerSpec = { id: string; type: string; filter?: unknown; paint?: Record<string, unknown> };

const layers = new Map<string, LayerSpec>();
const sources = new Map<string, { data: unknown }>();
const markers: Array<{ remove: () => void }> = [];
let lastSetData: unknown = null;
let mapInstance: {
  remove: ReturnType<typeof vi.fn>;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  getLayer: (id: string) => LayerSpec | undefined;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
  isStyleLoaded: () => boolean;
  once: (event: string, cb: () => void) => void;
  on: (event: string, cb: () => void) => void;
  addSource: (id: string, spec: { data: unknown }) => void;
  addLayer: (spec: LayerSpec) => void;
  fitBounds: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  addControl: ReturnType<typeof vi.fn>;
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
    });
    resize = vi.fn();
    addControl = vi.fn();
    fitBounds = vi.fn();
    isStyleLoaded = () => true;
    on(event: string, cb: () => void) {
      if (event === 'load') {
        this._loadHandlers.push(cb);
      }
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
          lastSetData = data;
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

const emptyScene: MapScene = { markers: [], routeLines: [], missingGeometry: [] };

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
    },
  ],
  missingGeometry: [],
};

describe('SearchMap route layers', () => {
  afterEach(() => {
    layers.clear();
    sources.clear();
    markers.length = 0;
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
      expect(lastSetData).toMatchObject({
        type: 'FeatureCollection',
        features: [
          { id: 'route:place:munich:p1:0', properties: { style: 'transit' } },
          { id: 'route:place:munich:p1:1', properties: { style: 'walk' } },
        ],
      });
    });
  });

  it('clears route features when the scene has no routes', async () => {
    const view = render(<SearchMap scene={routeScene} />);
    await waitFor(() => expect(sources.has(SEARCH_MAP_ROUTE_SOURCE_ID)).toBe(true));

    await act(async () => {
      view.rerender(<SearchMap scene={emptyScene} />);
    });

    await waitFor(() => {
      expect(lastSetData).toEqual({ type: 'FeatureCollection', features: [] });
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
