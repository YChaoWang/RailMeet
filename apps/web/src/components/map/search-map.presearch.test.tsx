/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_MAP_SCENE } from '@/lib/map-markers';
import {
  SEARCH_MAP_BASEMAP_PLACE_LABEL_IDS,
  SEARCH_MAP_BASEMAP_RAIL_LAYER_IDS,
  SEARCH_MAP_HILLSHADE_LAYER_ID,
  SEARCH_MAP_STATION_FETCH_ZOOM_MIN,
  SEARCH_MAP_STATION_LAYER_IDS,
  SEARCH_MAP_STATION_SOURCE_ID,
  SEARCH_MAP_TERRAIN_SOURCE_ID,
  SearchMap,
} from './search-map';

const fetchMapStops = vi.fn();
const planHits: string[] = [];

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
  fetchMapStops: (...args: unknown[]) => fetchMapStops(...args),
}));

type LayerSpec = { id: string; type: string };

const layers = new globalThis.Map<string, LayerSpec>();
const sources = new globalThis.Map<string, { data: unknown; type?: string }>();
const moveEndHandlers: Array<() => void> = [];
let stationSetDataCount = 0;
let mapInstance: {
  getZoom: () => number;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  getLayer: (id: string) => LayerSpec | undefined;
  addSource: (id: string, spec: { data?: unknown; type?: string }) => void;
  addLayer: (spec: LayerSpec) => void;
  moveLayer: ReturnType<typeof vi.fn>;
  addControl: ReturnType<typeof vi.fn>;
  getTerrain: () => null | { source: string };
  setTerrain: ReturnType<typeof vi.fn>;
  setLayoutProperty: ReturnType<typeof vi.fn>;
  setPaintProperty: ReturnType<typeof vi.fn>;
  _loadHandlers: Array<() => void>;
} | null = null;

vi.mock('maplibre-gl', () => {
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
      moveEndHandlers.length = 0;
    });
    resize = vi.fn();
    addControl = vi.fn();
    fitBounds = vi.fn();
    easeTo = vi.fn();
    setPaintProperty = vi.fn();
    setLayoutProperty = vi.fn();
    setTerrain = vi.fn();
    getTerrain = () => null;
    moveLayer = vi.fn();
    isStyleLoaded = () => false;
    loaded = () => false;
    getStyle = () => ({
      sources: {},
      layers: [
        { id: 'road_major_rail', type: 'line' },
        { id: 'label_city', type: 'symbol' },
        { id: 'poi_transit', type: 'symbol' },
      ],
    });
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
    getZoom = () => 7.5;
    getCanvas = () => ({ style: { cursor: '' } });
    queryRenderedFeatures = () => [];
    style = { _loaded: true };
    on(event: string, layerOrCb: string | (() => void), maybeCb?: () => void) {
      if (typeof layerOrCb === 'function') {
        if (event === 'load' || event === 'style.load' || event === 'styledata') {
          this._loadHandlers.push(layerOrCb);
        }
        if (event === 'moveend') {
          moveEndHandlers.push(layerOrCb);
        }
        return;
      }
      void maybeCb;
    }
    once() {}
    addSource(id: string, spec: { data?: unknown; type?: string }) {
      sources.set(id, {
        data: spec.data ?? null,
        ...(spec.type ? { type: spec.type } : {}),
      });
    }
    getSource(id: string) {
      const source = sources.get(id);
      if (!source) {
        return undefined;
      }
      return {
        setData: (data: unknown) => {
          source.data = data;
          if (id === SEARCH_MAP_STATION_SOURCE_ID) {
            stationSetDataCount += 1;
          }
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
      Marker: class {
        setLngLat() {
          return this;
        }
        setPopup() {
          return this;
        }
        addTo() {
          return this;
        }
        remove() {}
      },
      Popup: class {
        setHTML() {
          return this;
        }
      },
      LngLatBounds: class {
        extend() {
          return this;
        }
      },
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
    Marker: class {
      setLngLat() {
        return this;
      }
      setPopup() {
        return this;
      }
      addTo() {
        return this;
      }
      remove() {}
    },
    Popup: class {
      setHTML() {
        return this;
      }
    },
    LngLatBounds: class {
      extend() {
        return this;
      }
    },
    AttributionControl: class {},
    NavigationControl: class {},
    setWorkerUrl: vi.fn(),
    TerrainControl: class {
      onAdd() {
        const el = document.createElement('div');
        el.className = 'maplibregl-ctrl-terrain';
        return el;
      }
      onRemove() {}
    },
  };
});

describe('SearchMap pre-search transit context', () => {
  beforeEach(() => {
    layers.clear();
    sources.clear();
    moveEndHandlers.length = 0;
    stationSetDataCount = 0;
    mapInstance = null;
    planHits.length = 0;
    fetchMapStops.mockReset();
    fetchMapStops.mockResolvedValue({
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
          aggregated: true,
          minimumDetailZoom: 12,
          sourceFeatureCount: 1,
        },
      },
    });
  });

  afterEach(() => {
    layers.clear();
    sources.clear();
  });

  it('loads station overlay on an empty draft scene without search id or travelers', async () => {
    expect(SEARCH_MAP_STATION_FETCH_ZOOM_MIN).toBe(7);
    expect(SEARCH_MAP_BASEMAP_RAIL_LAYER_IDS).toContain('road_major_rail');
    expect(SEARCH_MAP_BASEMAP_PLACE_LABEL_IDS).toContain('label_city');

    render(<SearchMap scene={EMPTY_MAP_SCENE} />);

    await waitFor(() => {
      expect(sources.has(SEARCH_MAP_STATION_SOURCE_ID)).toBe(true);
    });
    await waitFor(() => {
      expect(fetchMapStops).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(stationSetDataCount).toBeGreaterThanOrEqual(1);
    });

    expect(SEARCH_MAP_STATION_LAYER_IDS.every((id) => layers.has(id))).toBe(true);
    expect(sources.has(SEARCH_MAP_TERRAIN_SOURCE_ID)).toBe(true);
    expect(layers.has(SEARCH_MAP_HILLSHADE_LAYER_ID)).toBe(true);
    expect(planHits).toHaveLength(0);
  });

  it('does not call /plan on moveend and refreshes stations once', async () => {
    render(<SearchMap scene={EMPTY_MAP_SCENE} />);
    await waitFor(() => expect(fetchMapStops).toHaveBeenCalledTimes(1));

    const callsBefore = fetchMapStops.mock.calls.length;
    for (const handler of moveEndHandlers) {
      handler();
    }
    await waitFor(() => {
      expect(fetchMapStops.mock.calls.length).toBeGreaterThanOrEqual(callsBefore);
    });
    expect(planHits).toHaveLength(0);
  });

  it('preserves station source when terrain control is present', async () => {
    render(<SearchMap scene={EMPTY_MAP_SCENE} />);
    await waitFor(() => expect(sources.has(SEARCH_MAP_STATION_SOURCE_ID)).toBe(true));
    expect(mapInstance?.addControl).toHaveBeenCalled();
    const stationBefore = sources.get(SEARCH_MAP_STATION_SOURCE_ID)?.data;
    expect(stationBefore).toBeTruthy();
  });
});
