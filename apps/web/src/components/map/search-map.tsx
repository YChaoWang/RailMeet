'use client';

import { useEffect, useRef, useState } from 'react';

import { useColorScheme, type ColorScheme } from '@/hooks/use-color-scheme';
import 'maplibre-gl/dist/maplibre-gl.css';

import { getMotisModeStyle, type MotisModeIconKind } from '@railmeet/shared';

import { formatMotisClock } from '@/lib/journey-leg-presentation';

import type {
  MapCandidateMarker,
  MapOriginMarker,
  MapScene,
  MapStopMarker,
  MapTravelerPopup,
} from '@/lib/map-markers';
import {
  MAP_WALK_COLOR,
  collectSceneCoordinates,
  originsToGeoJson,
} from '@/lib/map-markers';
import { ensureMapLibreWorker } from '@/lib/ensure-maplibre-worker';
import {
  fetchMapStops,
  isMapStopsViewportEligible,
  mapStopsQueryFromBounds,
} from '@/lib/map-stops-client';
import { formatArrivalSpreadMs, formatDurationMinutes } from '@/lib/search-view-model';
import { cn } from '@/lib/utils';

/** OpenFreeMap Positron — mapcn-style light gray basemap with required attribution. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** OpenFreeMap Dark — mapcn-style dark basemap. */
export const MAP_DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

export const MAP_STYLE_URLS = {
  light: MAP_STYLE_URL,
  dark: MAP_DARK_STYLE_URL,
} as const;

export function mapStyleUrlForScheme(scheme: ColorScheme): string {
  return MAP_STYLE_URLS[scheme];
}

/** Public-domain Terrarium DEM (AWS elevation tiles) for optional Terrain mode. */
export const TERRAIN_DEM_TILES_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const ROUTE_SOURCE_ID = 'railmeet-selected-routes';
const ROUTE_CASING_LAYER_ID = 'railmeet-selected-routes-casing';
const ROUTE_TRANSIT_LAYER_ID = 'railmeet-selected-routes-transit';
const ROUTE_WALK_LAYER_ID = 'railmeet-selected-routes-walk';
const ROUTE_STOP_SOURCE_ID = 'railmeet-route-stops';
const ROUTE_STOP_HIT_LAYER_ID = 'railmeet-route-stops-hit';
const ROUTE_STOP_RING_LAYER_ID = 'railmeet-route-stops-ring';
const ROUTE_STOP_CIRCLE_LAYER_ID = 'railmeet-route-stops-circle';
const ROUTE_STOP_LABEL_LAYER_ID = 'railmeet-route-stops-label';
const ORIGIN_SOURCE_ID = 'railmeet-traveler-origins';
const ORIGIN_CIRCLE_LAYER_ID = 'railmeet-traveler-origins-circle';
const ORIGIN_LABEL_LAYER_ID = 'railmeet-traveler-origins-label';
const STATION_SOURCE_ID = 'railmeet-viewport-stations';
const STATION_CLUSTER_LAYER_ID = 'railmeet-viewport-stations-clusters';

/** Mobile-safe popup width — also reinforced in globals.css for MapLibre popups. */
export const MAP_POPUP_MAX_WIDTH = 'min(280px, calc(100vw - 2rem))';

const MAP_STATUS_TOAST_CLASS =
  'pointer-events-none absolute left-1/2 z-[5] max-w-[min(90%,28rem)] -translate-x-1/2 rounded-lg bg-white/90 px-3 py-1.5 text-center text-[11px] text-ink-900 shadow-sm dark:bg-[#121a26]/90 dark:text-mist-50 max-md:top-14 max-md:bottom-auto md:bottom-3 md:left-[calc(50%+200px)] md:top-auto';
const STATION_CLUSTER_COUNT_LAYER_ID = 'railmeet-viewport-stations-cluster-count';
const STATION_POINT_LAYER_ID = 'railmeet-viewport-stations-points';
const STATION_LABEL_LAYER_ID = 'railmeet-viewport-stations-labels';
const TERRAIN_SOURCE_ID = 'railmeet-terrain-dem';
const HILLSHADE_LAYER_ID = 'railmeet-terrain-hillshade';

const ROUTE_LAYER_IDS = [
  ROUTE_CASING_LAYER_ID,
  ROUTE_TRANSIT_LAYER_ID,
  ROUTE_WALK_LAYER_ID,
] as const;

/** Bottom to top: hit target, transfer ring, stop circle, station name. */
const ROUTE_STOP_LAYER_IDS = [
  ROUTE_STOP_HIT_LAYER_ID,
  ROUTE_STOP_RING_LAYER_ID,
  ROUTE_STOP_CIRCLE_LAYER_ID,
  ROUTE_STOP_LABEL_LAYER_ID,
] as const;

/** Inspected OpenFreeMap Positron rail line layer IDs (do not invent). */
const BASEMAP_RAIL_LINE_IDS = [
  'railway',
  'railway_dashline',
  'railway_transit',
  'railway_transit_dashline',
  'railway_service',
  'railway_service_dashline',
] as const;

/** Inspected OpenFreeMap Positron place/country label layer IDs. */
const BASEMAP_PLACE_LABEL_IDS = [
  'label_other',
  'label_village',
  'label_town',
  'label_state',
  'label_city',
  'label_city_capital',
  'label_country_3',
  'label_country_2',
  'label_country_1',
] as const;

const STATION_FETCH_DEBOUNCE_MS = 400;
/** Below this zoom: basemap cities/rails only — no continental station download. */
const STATION_FETCH_ZOOM_MIN = 7;
const STATION_DETAIL_ZOOM_MIN = 10;
const STATION_INDIVIDUAL_ZOOM_MIN = 12;

export type MapFitPadding = {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
};

type SearchMapProps = {
  readonly scene: MapScene;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly fitPadding?: MapFitPadding;
  readonly onCandidateSelect?: (candidateId: string) => void;
  readonly onTravelerSelect?: (participantId: string | null) => void;
};

type MapLibreModule = typeof import('maplibre-gl');
type MapInstance = InstanceType<MapLibreModule['Map']>;
type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<Record<string, unknown>>;
};

type GeoJsonSetDataSource = {
  setData: (data: GeoJsonFeatureCollection) => void;
};

const DEFAULT_FIT_PADDING: MapFitPadding = { top: 56, bottom: 72, left: 56, right: 56 };

/**
 * Client-only MapLibre map.
 * Traveler origins use a persistent GeoJSON source (authoritative).
 * The MapLibre container is an inner div so React data-* updates never remount the canvas.
 */
export function SearchMap({
  scene,
  className,
  disabled = false,
  fitPadding = DEFAULT_FIT_PADDING,
  onCandidateSelect,
  onTravelerSelect,
}: SearchMapProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const markersRef = useRef<InstanceType<MapLibreModule['Marker']>[]>([]);
  const maplibreglRef = useRef<MapLibreModule | null>(null);
  const sceneRef = useRef(scene);
  const fitPaddingRef = useRef(fitPadding);
  const lastCameraKeyRef = useRef<string | null>(null);
  const styleReadyRef = useRef(false);
  const stationHandlersBoundRef = useRef(false);
  const stationRequestSeqRef = useRef(0);
  const stationAbortRef = useRef<AbortController | null>(null);
  const stationViewportKeyRef = useRef<string | null>(null);
  const stationCacheRef = useRef(new Map<string, GeoJsonFeatureCollection>());
  const onCandidateSelectRef = useRef(onCandidateSelect);
  const onTravelerSelectRef = useRef(onTravelerSelect);
  const colorScheme = useColorScheme();
  const colorSchemeRef = useRef(colorScheme);
  const mapStyleUrlRef = useRef(mapStyleUrlForScheme(colorScheme));
  const preserveCameraRef = useRef(false);
  colorSchemeRef.current = colorScheme;
  const [stationStatus, setStationStatus] = useState<
    'idle' | 'loading' | 'ready' | 'zoom' | 'error' | 'aggregated'
  >('idle');

  sceneRef.current = scene;
  fitPaddingRef.current = fitPadding;
  onCandidateSelectRef.current = onCandidateSelect;
  onTravelerSelectRef.current = onTravelerSelect;

  useEffect(() => {
    if (disabled || typeof window === 'undefined' || !containerRef.current) {
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let stationDebounce: number | undefined;

    void (async () => {
      const maplibregl = await import('maplibre-gl');
      if (cancelled || !containerRef.current) {
        return;
      }
      ensureMapLibreWorker();
      maplibreglRef.current = maplibregl;
      mapStyleUrlRef.current = mapStyleUrlForScheme(colorSchemeRef.current);
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyleUrlRef.current,
        // Paris region at a provider-safe span so the first station request can succeed
        // while OpenFreeMap cities/rails remain visible before any traveler is added.
        center: [2.3522, 48.8566],
        zoom: 11.6,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(
        new maplibregl.AttributionControl({
          compact: true,
          customAttribution: [
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            '© <a href="https://transitous.org/">Transitous</a> journey data',
          ],
        }),
        'top-right',
      );
      labelNavigationControls(wrapperRef.current ?? containerRef.current);
      mapRef.current = map;
      resizeObserver = new ResizeObserver(() => {
        map.resize();
      });
      resizeObserver.observe(containerRef.current);

      const applyCurrentScene = (forceFit: boolean) => {
        ensureStationLayers(map);
        ensureRouteLayers(map);
        removeRouteStopLayers(map);
        ensureOriginLayers(map);
        bindRouteInteractions(map, onTravelerSelectRef);
        applyScene({
          maplibregl,
          map,
          scene: sceneRef.current,
          markersRef,
          onCandidateSelectRef,
          onTravelerSelectRef,
          fitPadding: fitPaddingRef.current,
          lastCameraKeyRef,
          forceFit,
        });
      };

      const refreshStations = () => {
        const zoom = map.getZoom();
        const bounds = {
          minLon: map.getBounds().getWest(),
          minLat: map.getBounds().getSouth(),
          maxLon: map.getBounds().getEast(),
          maxLat: map.getBounds().getNorth(),
        };
        // Continental / wide views: keep basemap cities/rails; only fetch when the
        // provider can safely answer (zoom + span). Never treat oversized boxes as errors.
        if (zoom < STATION_FETCH_ZOOM_MIN || !isMapStopsViewportEligible(bounds)) {
          setStationStatus('zoom');
          stationViewportKeyRef.current = null;
          return;
        }

        const query = mapStopsQueryFromBounds(bounds, zoom);
        const viewportKey = [
          query.minLon.toFixed(3),
          query.minLat.toFixed(3),
          query.maxLon.toFixed(3),
          query.maxLat.toFixed(3),
          Math.floor(query.zoom),
        ].join(':');

        if (viewportKey === stationViewportKeyRef.current) {
          return;
        }

        const cached = stationCacheRef.current.get(viewportKey);
        if (cached) {
          const source = map.getSource(STATION_SOURCE_ID) as GeoJsonSetDataSource | undefined;
          source?.setData(cached);
          stationViewportKeyRef.current = viewportKey;
          setStationStatus('ready');
          return;
        }

        stationAbortRef.current?.abort();
        const controller = new AbortController();
        stationAbortRef.current = controller;
        const seq = ++stationRequestSeqRef.current;
        setStationStatus('loading');

        void fetchMapStops(query, { signal: controller.signal })
          .then((result) => {
            if (seq !== stationRequestSeqRef.current || controller.signal.aborted) {
              return;
            }
            if (!result.ok) {
              setStationStatus('error');
              return;
            }
            const collection: GeoJsonFeatureCollection = {
              type: 'FeatureCollection',
              features: result.data.features.map((feature) => ({
                type: 'Feature',
                id: feature.properties.stopId,
                properties: {
                  stationId: feature.properties.stopId,
                  name: feature.properties.name,
                  kind: feature.properties.kind,
                  importance: feature.properties.importance,
                  provider: 'transitous',
                  cluster: false,
                },
                geometry: feature.geometry,
              })),
            };
            if (stationCacheRef.current.size > 40) {
              const oldest = stationCacheRef.current.keys().next().value;
              if (oldest) {
                stationCacheRef.current.delete(oldest);
              }
            }
            stationCacheRef.current.set(viewportKey, collection);
            const source = map.getSource(STATION_SOURCE_ID) as GeoJsonSetDataSource | undefined;
            source?.setData(collection);
            stationViewportKeyRef.current = viewportKey;
            setStationStatus(
              result.data.metadata.aggregated ||
                result.data.metadata.truncated ||
                zoom < STATION_INDIVIDUAL_ZOOM_MIN
                ? 'aggregated'
                : 'ready',
            );
          })
          .catch((error: unknown) => {
            // Expected when a newer viewport aborts the previous request.
            if (controller.signal.aborted || isAbortError(error)) {
              return;
            }
            if (seq !== stationRequestSeqRef.current) {
              return;
            }
            setStationStatus('error');
          });
      };

      let appliedStyleUrl: string | null = null;
      const onStyleReady = () => {
        if (cancelled) {
          return;
        }
        // Prefer style stylesheet readiness over map.loaded()/isStyleLoaded().
        // OpenFreeMap can paint tiles while image/sprite loading keeps loaded() false forever,
        // which would otherwise skip traveler/station overlays entirely.
        const style = (map as unknown as { style?: { _loaded?: boolean } }).style;
        if (!style?._loaded && !map.getStyle()) {
          return;
        }
        const wantedStyle = mapStyleUrlRef.current;
        if (appliedStyleUrl === wantedStyle && styleReadyRef.current) {
          return;
        }
        appliedStyleUrl = wantedStyle;
        styleReadyRef.current = true;
        wrapperRef.current?.setAttribute('data-style-ready', '1');
        wrapperRef.current?.setAttribute('data-map-theme', colorSchemeRef.current);
        try {
          enhanceBasemapTransport(map, colorSchemeRef.current);
          ensureTerrainSupport(map, maplibregl);
          // Defer custom sources slightly so the basemap vector pipeline can start.
          // Custom overlays still apply on the next turn via applyCurrentScene.
          window.setTimeout(() => {
            if (cancelled || mapRef.current !== map) {
              return;
            }
            applyCurrentScene(!preserveCameraRef.current);
            preserveCameraRef.current = false;
            raiseTravelerLayers(map);
            labelNavigationControls(wrapperRef.current ?? containerRef.current);
            labelTerrainControl(wrapperRef.current ?? containerRef.current);
            if (!stationHandlersBoundRef.current) {
              stationHandlersBoundRef.current = true;
              map.on('moveend', () => {
                window.clearTimeout(stationDebounce);
                stationDebounce = window.setTimeout(() => {
                  refreshStations();
                }, STATION_FETCH_DEBOUNCE_MS);
              });
              map.on('click', STATION_CLUSTER_LAYER_ID, (event) => {
                const features = map.queryRenderedFeatures(event.point, {
                  layers: [STATION_CLUSTER_LAYER_ID],
                });
                const clusterId = features[0]?.properties?.cluster_id;
                const source = map.getSource(STATION_SOURCE_ID) as
                  | {
                      getClusterExpansionZoom: (
                        clusterId: number,
                        cb: (error: Error | null, zoom: number) => void,
                      ) => void;
                    }
                  | undefined;
                if (typeof clusterId !== 'number' || !source) {
                  return;
                }
                source.getClusterExpansionZoom(clusterId, (error, zoom) => {
                  if (error) {
                    return;
                  }
                  const coordinates = (
                    features[0]?.geometry as
                      { type?: string; coordinates?: [number, number] } | undefined
                  )?.coordinates;
                  if (!coordinates) {
                    return;
                  }
                  map.easeTo({ center: coordinates as [number, number], zoom });
                });
              });
              map.on('click', STATION_POINT_LAYER_ID, (event) => {
                const feature = event.features?.[0];
                if (!feature || feature.geometry.type !== 'Point') {
                  return;
                }
                const name = String(feature.properties?.name ?? 'Station');
                const kind = String(feature.properties?.kind ?? 'other');
                const importance = String(feature.properties?.importance ?? 'local');
                new maplibregl.Popup({ offset: 12, closeButton: true, maxWidth: MAP_POPUP_MAX_WIDTH })
                  .setLngLat(feature.geometry.coordinates as [number, number])
                  .setHTML(
                    `<strong>${escapeHtml(name)}</strong><div>${escapeHtml(kind)} · ${escapeHtml(importance)}</div><div>Data © Transitous</div>`,
                  )
                  .addTo(map);
              });
              map.on('mouseenter', STATION_POINT_LAYER_ID, () => {
                map.getCanvas().style.cursor = 'pointer';
              });
              map.on('mouseleave', STATION_POINT_LAYER_ID, () => {
                map.getCanvas().style.cursor = '';
              });
              map.on('mouseenter', STATION_CLUSTER_LAYER_ID, () => {
                map.getCanvas().style.cursor = 'pointer';
              });
              map.on('mouseleave', STATION_CLUSTER_LAYER_ID, () => {
                map.getCanvas().style.cursor = '';
              });
            }
            refreshStations();
          }, 0);
        } catch {
          appliedStyleUrl = null;
          styleReadyRef.current = false;
          wrapperRef.current?.removeAttribute('data-style-ready');
        }
      };

      map.on('style.load', onStyleReady);
      map.on('load', onStyleReady);
      map.on('styledata', onStyleReady);
      // Style JSON may already be present before listeners attach.
      queueMicrotask(onStyleReady);
      window.setTimeout(onStyleReady, 0);
      window.setTimeout(onStyleReady, 250);
    })();

    return () => {
      cancelled = true;
      styleReadyRef.current = false;
      window.clearTimeout(stationDebounce);
      stationAbortRef.current?.abort();
      resizeObserver?.disconnect();
      clearMarkers(markersRef);
      stationHandlersBoundRef.current = false;
      const map = mapRef.current;
      if (map) {
        removeStationLayers(map);
        removeOriginLayers(map);
        removeRouteStopLayers(map);
        removeRouteLayers(map);
        map.remove();
      }
      mapRef.current = null;
      lastCameraKeyRef.current = null;
    };
  }, [disabled]);

  useEffect(() => {
    const map = mapRef.current;
    const nextStyle = mapStyleUrlForScheme(colorScheme);
    if (!map || disabled || mapStyleUrlRef.current === nextStyle) {
      return;
    }
    mapStyleUrlRef.current = nextStyle;
    styleReadyRef.current = false;
    preserveCameraRef.current = true;
    stationViewportKeyRef.current = null;
    wrapperRef.current?.removeAttribute('data-style-ready');
    map.setStyle(nextStyle, { diff: false });
  }, [colorScheme, disabled]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreglRef.current;
    if (!map || !maplibregl || disabled || !styleReadyRef.current) {
      return;
    }
    ensureStationLayers(map);
    ensureRouteLayers(map);
    removeRouteStopLayers(map);
    ensureOriginLayers(map);
    bindRouteInteractions(map, onTravelerSelectRef);
    applyScene({
      maplibregl,
      map,
      scene,
      markersRef,
      onCandidateSelectRef,
      onTravelerSelectRef,
      fitPadding,
      lastCameraKeyRef,
      forceFit: false,
    });
  }, [scene, disabled, fitPadding]);

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'relative h-full min-h-[12rem] w-full min-w-0 bg-[#d9e2ec] dark:bg-[#0b1220]',
        className,
      )}
      data-testid="search-map"
      data-map-theme={colorScheme}
      data-marker-count={scene.markers.length}
      data-route-line-count={scene.routeLines.length}
      data-route-segment-count={scene.routeLines.length}
      data-camera-key={scene.cameraKey}
      data-fit-bottom={fitPadding.bottom}
      data-fit-left={fitPadding.left}
      data-station-status={stationStatus}
      role="img"
      aria-label="Map of traveler origins, meeting candidates, stations, and selected transit routes"
    >
      {/* Inner node is owned by MapLibre — keep React attributes on the wrapper only. */}
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      {stationStatus === 'loading' ? (
        <p className={cn(MAP_STATUS_TOAST_CLASS, 'text-ink-700')}>
          Loading stations…
        </p>
      ) : null}
      {stationStatus === 'zoom' || stationStatus === 'aggregated' ? (
        <p className={cn(MAP_STATUS_TOAST_CLASS, 'text-ink-700')}>
          {stationStatus === 'aggregated'
            ? 'Zoom in to view individual stations'
            : 'Zoom in to view stations in this area'}
        </p>
      ) : null}
      {stationStatus === 'error' ? (
        <p className={cn(MAP_STATUS_TOAST_CLASS, 'text-amber-800')}>
          Stations could not be refreshed. Traveler planning still works.
        </p>
      ) : null}
    </div>
  );
}

function labelNavigationControls(container: HTMLElement | null) {
  if (!container) {
    return;
  }
  container.querySelector('.maplibregl-ctrl-zoom-in')?.setAttribute('aria-label', 'Zoom in');
  container.querySelector('.maplibregl-ctrl-zoom-out')?.setAttribute('aria-label', 'Zoom out');
}

function clearMarkers(markersRef: { current: InstanceType<MapLibreModule['Marker']>[] }) {
  for (const marker of markersRef.current) {
    marker.remove();
  }
  markersRef.current = [];
}

function enhanceBasemapTransport(map: MapInstance, scheme: ColorScheme = 'light') {
  for (const layerId of BASEMAP_RAIL_LINE_IDS) {
    if (!map.getLayer(layerId)) {
      continue;
    }
    try {
      map.setLayoutProperty(layerId, 'visibility', 'visible');
    } catch {
      // Keep stock Positron rail styling.
    }
  }

  for (const layerId of BASEMAP_PLACE_LABEL_IDS) {
    if (!map.getLayer(layerId)) {
      continue;
    }
    try {
      map.setLayoutProperty(layerId, 'visibility', 'visible');
      map.setPaintProperty(layerId, 'text-opacity', 1);
      map.setPaintProperty(layerId, 'text-halo-width', 1.4);
      map.setPaintProperty(layerId, 'text-halo-color', scheme === 'dark' ? '#0b1220' : '#ffffff');
    } catch {
      // Keep stock labels.
    }
  }
}

function firstSymbolLayerId(map: MapInstance): string | undefined {
  const style = map.getStyle();
  const layers = style?.layers;
  if (!layers) {
    return undefined;
  }
  for (const layer of layers) {
    if (layer.type === 'symbol') {
      return layer.id;
    }
  }
  return undefined;
}

/**
 * Terrain is a background DEM/hillshade toggle — never setStyle().
 * Preserves station GeoJSON, routes, and traveler markers.
 */
function ensureTerrainSupport(map: MapInstance, maplibregl: MapLibreModule) {
  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    map.addSource(TERRAIN_SOURCE_ID, {
      type: 'raster-dem',
      tiles: [TERRAIN_DEM_TILES_URL],
      tileSize: 256,
      maxzoom: 15,
      encoding: 'terrarium',
      attribution:
        'Terrain © <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>',
    });
  }
  if (!map.getLayer(HILLSHADE_LAYER_ID)) {
    const beforeId = firstSymbolLayerId(map);
    map.addLayer(
      {
        id: HILLSHADE_LAYER_ID,
        type: 'hillshade',
        source: TERRAIN_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'hillshade-exaggeration': 0.28,
          'hillshade-shadow-color': '#5b6470',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-illumination-anchor': 'map',
        },
      },
      beforeId,
    );
  }

  const alreadyHasTerrainControl = Boolean(
    (map.getContainer().parentElement ?? map.getContainer()).querySelector(
      '.maplibregl-ctrl-terrain',
    ),
  );
  if (!alreadyHasTerrainControl) {
    map.addControl(
      new maplibregl.TerrainControl({
        source: TERRAIN_SOURCE_ID,
        exaggeration: 1.05,
      }),
      'top-right',
    );
  }

  map.on('terrain', () => {
    const enabled = Boolean(map.getTerrain());
    if (map.getLayer(HILLSHADE_LAYER_ID)) {
      try {
        map.setLayoutProperty(HILLSHADE_LAYER_ID, 'visibility', enabled ? 'visible' : 'none');
      } catch {
        // Ignore transient style races.
      }
    }
    raiseTravelerLayers(map);
  });
}

function raiseTravelerLayers(map: MapInstance) {
  for (const layerId of [
    STATION_CLUSTER_LAYER_ID,
    STATION_CLUSTER_COUNT_LAYER_ID,
    STATION_POINT_LAYER_ID,
    STATION_LABEL_LAYER_ID,
    ROUTE_CASING_LAYER_ID,
    ROUTE_TRANSIT_LAYER_ID,
    ROUTE_WALK_LAYER_ID,
    ORIGIN_CIRCLE_LAYER_ID,
    ORIGIN_LABEL_LAYER_ID,
  ]) {
    if (map.getLayer(layerId)) {
      try {
        map.moveLayer(layerId);
      } catch {
        // Layer may be mid-add.
      }
    }
  }
}

function labelTerrainControl(container: HTMLElement | null) {
  if (!container) {
    return;
  }
  container.querySelector('.maplibregl-ctrl-terrain')?.setAttribute('aria-label', 'Toggle terrain');
}

function ensureOriginLayers(map: MapInstance) {
  if (!map.getSource(ORIGIN_SOURCE_ID)) {
    map.addSource(ORIGIN_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(ORIGIN_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: ORIGIN_CIRCLE_LAYER_ID,
      type: 'circle',
      source: ORIGIN_SOURCE_ID,
      paint: {
        'circle-radius': 12,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff',
        // HTML markers are the visible traveler affordance; keep GeoJSON for hit-testing backup.
        'circle-opacity': 0,
        'circle-stroke-opacity': 0,
      },
    });
  }
  if (!map.getLayer(ORIGIN_LABEL_LAYER_ID)) {
    try {
      map.addLayer({
        id: ORIGIN_LABEL_LAYER_ID,
        type: 'symbol',
        source: ORIGIN_SOURCE_ID,
        layout: {
          'text-field': ['get', 'travelerLabel'],
          'text-size': 12,
          'text-font': ['Noto Sans Bold'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });
    } catch {
      // Labels are optional if the glyph stack rejects the font list.
    }
  }
}

function ensureStationLayers(map: MapInstance) {
  if (!map.getSource(STATION_SOURCE_ID)) {
    map.addSource(STATION_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: STATION_INDIVIDUAL_ZOOM_MIN - 1,
      clusterRadius: 44,
    });
  }
  if (!map.getLayer(STATION_CLUSTER_LAYER_ID)) {
    map.addLayer({
      id: STATION_CLUSTER_LAYER_ID,
      type: 'circle',
      source: STATION_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#5b6b7c',
        'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 22],
        'circle-opacity': 0.85,
      },
    });
  }
  if (!map.getLayer(STATION_CLUSTER_COUNT_LAYER_ID)) {
    map.addLayer({
      id: STATION_CLUSTER_COUNT_LAYER_ID,
      type: 'symbol',
      source: STATION_SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 11,
        'text-font': ['Noto Sans Bold'],
      },
      paint: { 'text-color': '#ffffff' },
    });
  }
  if (!map.getLayer(STATION_POINT_LAYER_ID)) {
    map.addLayer({
      id: STATION_POINT_LAYER_ID,
      type: 'circle',
      source: STATION_SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['match', ['get', 'importance'], 'major', 7, 'regional', 5.5, 4],
        'circle-color': '#334155',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.9,
      },
    });
  }
  if (!map.getLayer(STATION_LABEL_LAYER_ID)) {
    try {
      map.addLayer({
        id: STATION_LABEL_LAYER_ID,
        type: 'symbol',
        source: STATION_SOURCE_ID,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'importance'], 'major']],
        minzoom: STATION_INDIVIDUAL_ZOOM_MIN,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#1e293b',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
        },
      });
    } catch {
      // Optional labels.
    }
  }
}

function removeOriginLayers(map: MapInstance) {
  for (const layerId of [ORIGIN_LABEL_LAYER_ID, ORIGIN_CIRCLE_LAYER_ID]) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  if (map.getSource(ORIGIN_SOURCE_ID)) {
    map.removeSource(ORIGIN_SOURCE_ID);
  }
}

function removeStationLayers(map: MapInstance) {
  for (const layerId of [
    STATION_LABEL_LAYER_ID,
    STATION_POINT_LAYER_ID,
    STATION_CLUSTER_COUNT_LAYER_ID,
    STATION_CLUSTER_LAYER_ID,
  ]) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  if (map.getSource(STATION_SOURCE_ID)) {
    map.removeSource(STATION_SOURCE_ID);
  }
}

function ensureRouteLayers(map: MapInstance) {
  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    });
  }
  if (!map.getLayer(ROUTE_CASING_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_CASING_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      paint: {
        'line-color': '#ffffff',
        'line-width': ['case', ['get', 'emphasized'], 8, 6],
        'line-opacity': ['case', ['get', 'emphasized'], 0.95, 0.45],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
  if (!map.getLayer(ROUTE_TRANSIT_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_TRANSIT_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'style'], 'transit'],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['get', 'emphasized'], 5, 3.5],
        'line-opacity': ['case', ['get', 'emphasized'], 1, 0.35],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
  if (!map.getLayer(ROUTE_WALK_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_WALK_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'style'], 'walk'],
      paint: {
        // Walking is never a route or traveler color — always neutral gray dashes.
        'line-color': MAP_WALK_COLOR,
        'line-width': ['case', ['get', 'emphasized'], 4, 2.5],
        'line-opacity': ['case', ['get', 'emphasized'], 0.95, 0.3],
        'line-dasharray': [1.2, 1.6],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
}

const ROUTE_LAYER_HANDLER_KEY = '__railmeetRouteLayerHandlers';

type RouteLayerHandlers = {
  onClick: (event: { features?: Array<{ properties?: Record<string, unknown> | null }> }) => void;
  onEnter: () => void;
  onLeave: () => void;
};

function bindRouteInteractions(
  map: MapInstance,
  onTravelerSelectRef: { current: ((participantId: string | null) => void) | undefined },
) {
  const layerIds = [ROUTE_TRANSIT_LAYER_ID, ROUTE_WALK_LAYER_ID, ORIGIN_CIRCLE_LAYER_ID];
  const host = map as MapInstance & { [ROUTE_LAYER_HANDLER_KEY]?: RouteLayerHandlers };
  const previous = host[ROUTE_LAYER_HANDLER_KEY];
  if (previous) {
    for (const layerId of layerIds) {
      map.off('click', layerId, previous.onClick);
      map.off('mouseenter', layerId, previous.onEnter);
      map.off('mouseleave', layerId, previous.onLeave);
    }
  }

  const next: RouteLayerHandlers = {
    onClick: (event) => {
      const props = event.features?.[0]?.properties;
      const participantId =
        (typeof props?.participantId === 'string' && props.participantId) ||
        (typeof props?.travelerId === 'string' && props.travelerId) ||
        null;
      if (participantId) {
        onTravelerSelectRef.current?.(participantId);
      }
    },
    onEnter: () => {
      map.getCanvas().style.cursor = 'pointer';
    },
    onLeave: () => {
      map.getCanvas().style.cursor = '';
    },
  };

  for (const layerId of layerIds) {
    map.on('click', layerId, next.onClick);
    map.on('mouseenter', layerId, next.onEnter);
    map.on('mouseleave', layerId, next.onLeave);
  }
  host[ROUTE_LAYER_HANDLER_KEY] = next;
}

function removeRouteStopLayers(map: MapInstance) {
  for (const layerId of [...ROUTE_STOP_LAYER_IDS].reverse()) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  if (map.getSource(ROUTE_STOP_SOURCE_ID)) {
    map.removeSource(ROUTE_STOP_SOURCE_ID);
  }
}

function removeRouteLayers(map: MapInstance) {
  for (const layerId of [ROUTE_WALK_LAYER_ID, ROUTE_TRANSIT_LAYER_ID, ROUTE_CASING_LAYER_ID]) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  if (map.getSource(ROUTE_SOURCE_ID)) {
    map.removeSource(ROUTE_SOURCE_ID);
  }
}

type RouteFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    properties: Record<string, string | number | boolean>;
    geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
  }>;
};

function emptyFeatureCollection(): RouteFeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function applyScene(options: {
  maplibregl: MapLibreModule;
  map: MapInstance;
  scene: MapScene;
  markersRef: { current: InstanceType<MapLibreModule['Marker']>[] };
  onCandidateSelectRef: { current: ((candidateId: string) => void) | undefined };
  onTravelerSelectRef: { current: ((participantId: string | null) => void) | undefined };
  fitPadding: MapFitPadding;
  lastCameraKeyRef: { current: string | null };
  forceFit: boolean;
}) {
  const {
    maplibregl,
    map,
    scene,
    markersRef,
    onCandidateSelectRef,
    onTravelerSelectRef,
    fitPadding,
    lastCameraKeyRef,
    forceFit,
  } = options;

  clearMarkers(markersRef);

  const originSource = map.getSource(ORIGIN_SOURCE_ID) as
    { setData: (data: ReturnType<typeof originsToGeoJson>) => void } | undefined;
  if (originSource) {
    originSource.setData(originsToGeoJson(scene));
  }

  const appliedOrigins = scene.markers.filter((marker) => marker.kind === 'origin');
  const host = map.getContainer().parentElement;
  if (host) {
    host.setAttribute('data-applied-origin-count', String(appliedOrigins.length));
    host.setAttribute(
      'data-applied-origin-coords',
      appliedOrigins
        .map((marker) => `${marker.longitude.toFixed(5)},${marker.latitude.toFixed(5)}`)
        .join('|'),
    );
  }

  const source = map.getSource(ROUTE_SOURCE_ID) as
    { setData: (data: RouteFeatureCollection) => void } | undefined;
  if (source) {
    source.setData({
      type: 'FeatureCollection',
      features: scene.routeLines.map((segment) => ({
        type: 'Feature',
        id: segment.id,
        properties: {
          id: segment.id,
          participantId: segment.participantId,
          // Transitous routeColor (or MOTIS mode default) — never the traveler color.
          color: segment.color,
          textColor: segment.textColor,
          colorSource: segment.colorSource,
          style: segment.style,
          emphasized: segment.emphasized,
          letter: segment.letter,
          mode: segment.mode,
          motisMode: segment.motisMode,
          serviceLabel: segment.serviceLabel,
          displayName: segment.displayName ?? '',
          routeShortName: segment.routeShortName ?? '',
          tripShortName: segment.tripShortName ?? '',
          agencyName: segment.agencyName ?? '',
          headsign: segment.headsign ?? '',
          fromName: segment.fromName ?? '',
          toName: segment.toName ?? '',
          departureAt: segment.departureAt,
          arrivalAt: segment.arrivalAt,
          intermediateStopCount: segment.intermediateStopCount,
        },
        geometry: {
          type: 'LineString',
          coordinates: segment.coordinates.map((pair) => [pair[0], pair[1]]),
        },
      })),
    });
  }

  // Meeting-point candidates remain HTML so they stay keyboard-clickable.
  // Route stops are HTML dots only — old MapLibre stop layers are removed.
  for (const item of scene.markers) {
    if (item.kind !== 'candidate') {
      continue;
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = item.selected
      ? 'railmeet-map-marker railmeet-map-marker-meeting'
      : 'railmeet-map-marker railmeet-map-marker-candidate';
    el.setAttribute('aria-label', markerAriaLabel(item));
    el.style.cssText = markerStyle(item);
    if (item.selected) {
      el.innerHTML = DESTINATION_PIN_SVG;
    } else {
      el.textContent = String(item.rank);
    }

    el.addEventListener('click', () => {
      onCandidateSelectRef.current?.(item.id.replace(/^candidate:/, ''));
    });

    const popup = new maplibregl.Popup({
      offset: item.selected ? 28 : 14,
      closeButton: true,
      maxWidth: MAP_POPUP_MAX_WIDTH,
      className: 'railmeet-map-popup',
    }).setHTML(meetingPopupHtml(item, { longitude: item.longitude, latitude: item.latitude }));

    const marker = new maplibregl.Marker({
      element: el,
      anchor: item.selected ? 'bottom' : 'center',
      pitchAlignment: 'viewport',
    })
      .setLngLat([item.longitude, item.latitude])
      .setPopup(popup)
      .addTo(map);

    markersRef.current.push(marker);
  }

  for (const item of scene.markers) {
    if (item.kind !== 'stop') {
      continue;
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'railmeet-map-marker railmeet-map-marker-stop';
    el.setAttribute('aria-label', `${STOP_ROLE_LABELS[item.role]}: ${item.name}`);
    el.style.opacity = item.emphasized ? '1' : '0.35';
    const dot = document.createElement('span');
    dot.className = 'railmeet-stop-dot';
    dot.style.background = item.color;
    if (item.ringColor) {
      el.style.boxShadow = `0 0 0 3px ${item.ringColor}`;
    }
    el.append(dot);

    const popup = new maplibregl.Popup({
      offset: 10,
      closeButton: true,
      maxWidth: MAP_POPUP_MAX_WIDTH,
      className: 'railmeet-map-popup',
    }).setHTML(stopMarkerPopupHtml(item));

    const marker = new maplibregl.Marker({
      element: el,
      anchor: 'center',
      pitchAlignment: 'viewport',
    })
      .setLngLat([item.longitude, item.latitude])
      .setPopup(popup)
      .addTo(map);
    attachMarkerTooltip(marker, maplibregl, map, item.name);
    markersRef.current.push(marker);
  }

  // Accessible traveler markers (authoritative visible path). GeoJSON circles stay as backup fill.
  for (const item of scene.markers) {
    if (item.kind !== 'origin') {
      continue;
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'railmeet-map-marker railmeet-map-marker-origin';
    el.setAttribute('aria-label', markerAriaLabel(item));
    el.dataset.travelerId = item.participantId;
    el.dataset.travelerLetter = item.letter;
    el.style.cssText = [
      'width:30px;height:30px;border-radius:999px;border:2.5px solid #ffffff;',
      `background:${item.color};color:#ffffff;`,
      'font:700 13px/30px "IBM Plex Sans",system-ui,sans-serif;',
      'cursor:pointer;z-index:5;box-shadow:0 1px 5px rgba(15,23,42,0.35);',
      'padding:0;display:grid;place-items:center;',
    ].join('');
    el.textContent = item.letter;
    el.addEventListener('click', () => {
      onTravelerSelectRef.current?.(item.participantId);
    });
    const popup = new maplibregl.Popup({
      offset: 14,
      closeButton: true,
      maxWidth: MAP_POPUP_MAX_WIDTH,
      className: 'railmeet-map-popup',
    }).setHTML(travelerPopupHtml(item));
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([item.longitude, item.latitude])
      .setPopup(popup)
      .addTo(map);
    markersRef.current.push(marker);
  }

  const shouldFit =
    (forceFit || lastCameraKeyRef.current !== scene.cameraKey) &&
    collectSceneCoordinates(scene).length > 0;
  if (shouldFit) {
    const originMarkers = scene.markers.filter((marker) => marker.kind === 'origin');
    const hasRoutesOrCandidates =
      scene.routeLines.length > 0 || scene.markers.some((marker) => marker.kind === 'candidate');

    if (!hasRoutesOrCandidates && originMarkers.length === 1) {
      const only = originMarkers[0]!;
      map.easeTo({
        center: [only.longitude, only.latitude],
        zoom: 11,
        duration: forceFit || lastCameraKeyRef.current === null ? 0 : 450,
        padding: { ...fitPadding },
      });
    } else {
      const bounds = new maplibregl.LngLatBounds();
      for (const [longitude, latitude] of collectSceneCoordinates(scene)) {
        bounds.extend([longitude, latitude]);
      }
      map.fitBounds(bounds, {
        padding: { ...fitPadding },
        maxZoom: 12,
        duration: forceFit || lastCameraKeyRef.current === null ? 0 : 450,
      });
    }
    lastCameraKeyRef.current = scene.cameraKey;
  }
}

const STOP_ROLE_LABELS: Record<MapStopMarker['role'], string> = {
  'origin-station': 'Departure station',
  intermediate: 'Intermediate stop',
  transfer: 'Transfer',
  meeting: 'Meeting point',
};

function travelerPopupHtml(item: MapOriginMarker): string {
  const popup = item.popup;
  if (!popup) {
    return [
      `<div class="railmeet-map-popup-body">`,
      `<p class="railmeet-map-popup-title">${escapeHtml(item.label)}</p>`,
      `<p class="railmeet-map-popup-line">Origin · Traveler ${escapeHtml(item.letter)}</p>`,
      `</div>`,
    ].join('');
  }
  return travelerSummaryHtml(popup);
}

function travelerSummaryHtml(popup: MapTravelerPopup): string {
  return [
    `<div class="railmeet-map-popup-body">`,
    `<p class="railmeet-map-popup-title">${escapeHtml(popup.displayName)}</p>`,
    `<p class="railmeet-map-popup-line">Traveler ${escapeHtml(popup.letter)} · ${escapeHtml(popup.originLabel)}</p>`,
    `<p class="railmeet-map-popup-line">Departs ${escapeHtml(formatPopupTime(popup.departureAt))}</p>`,
    `<p class="railmeet-map-popup-line">Arrives ${escapeHtml(formatPopupTime(popup.arrivalAt))}</p>`,
    `<p class="railmeet-map-popup-line">${escapeHtml(formatDurationMinutes(popup.durationMinutes))} · ${popup.transfers} transfers</p>`,
    `</div>`,
  ].join('');
}

function formatMapCoord(value: number): string {
  return value.toFixed(4);
}

function coordLineHtml(latitude: number, longitude: number): string {
  return `<p class="railmeet-map-popup-coords">${escapeHtml(formatMapCoord(latitude))}, ${escapeHtml(formatMapCoord(longitude))}</p>`;
}

function meetingPopupHtml(
  item: MapCandidateMarker,
  coords: { readonly longitude: number; readonly latitude: number },
): string {
  const popup = item.popup;
  const title = popup?.name ?? item.label;
  const rows = [
    `<div class="railmeet-map-popup-body">`,
    `<p class="railmeet-map-popup-title">${escapeHtml(title)}</p>`,
    coordLineHtml(coords.latitude, coords.longitude),
  ];
  if (!popup) {
    rows.push(`</div>`);
    return rows.join('');
  }
  rows.push(
    `<p class="railmeet-map-popup-line">Arrivals ${escapeHtml(formatPopupTime(popup.earliestArrivalAt))} – ${escapeHtml(formatPopupTime(popup.latestArrivalAt))}</p>`,
    `<p class="railmeet-map-popup-line">Spread ${escapeHtml(formatArrivalSpreadMs(popup.arrivalSpreadMs))}</p>`,
    `</div>`,
  );
  return rows.join('');
}

function stopMarkerPopupHtml(item: MapStopMarker): string {
  return renderStopCardHtml({
    name: item.name,
    role: item.role,
    letter: item.letter,
    arrivalAt: item.arrivalAt ?? '',
    departureAt: item.departureAt ?? '',
    track: item.track ?? '',
    arrivingService: item.arrivingService ?? '',
    departingService: item.departingService ?? '',
    arrivingMode: item.arrivingMode ?? '',
    departingMode: item.departingMode ?? '',
    color: item.color,
    borderColor: item.borderColor,
    ringColor: item.ringColor ?? '',
    textColor: item.textColor,
  });
}

export function renderStopCardHtml(input: {
  readonly name: string;
  readonly role: MapStopMarker['role'];
  readonly letter: string;
  readonly arrivalAt: string;
  readonly departureAt: string;
  readonly track: string;
  readonly arrivingService: string;
  readonly departingService: string;
  readonly arrivingMode: string;
  readonly departingMode: string;
  readonly color: string;
  readonly borderColor: string;
  readonly ringColor: string;
  readonly textColor: string;
}): string {
  const chips: string[] = [];
  const departing = input.departingService || input.arrivingService;
  const departingMode = input.departingMode || input.arrivingMode;
  const arriving = input.arrivingService;
  const showArrivingChip =
    Boolean(arriving) && Boolean(input.departingService) && arriving !== input.departingService;

  if (showArrivingChip && arriving) {
    chips.push(
      serviceChipHtml(
        arriving,
        input.arrivingMode,
        input.ringColor || input.color,
        input.textColor,
      ),
    );
  }
  if (departing) {
    chips.push(
      serviceChipHtml(departing, departingMode, input.borderColor || input.color, input.textColor),
    );
  }

  const times: string[] = [];
  if (input.arrivalAt) {
    times.push(
      `<div><dt>Arrives</dt><dd>${escapeHtml(formatMotisClock(input.arrivalAt))}</dd></div>`,
    );
  }
  if (input.departureAt) {
    times.push(
      `<div><dt>Departs</dt><dd>${escapeHtml(formatMotisClock(input.departureAt))}</dd></div>`,
    );
  }

  const roleLabel = STOP_ROLE_LABELS[input.role] ?? 'Stop';
  const meta = [
    roleLabel,
    input.letter ? `Traveler ${input.letter}` : '',
    input.track ? `Track ${input.track}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return [
    `<div class="railmeet-stop-popup">`,
    chips.length > 0 ? `<div class="railmeet-stop-popup-chips">${chips.join('')}</div>` : '',
    `<p class="railmeet-map-popup-title">${escapeHtml(input.name)}</p>`,
    times.length > 0 ? `<dl class="railmeet-stop-popup-times">${times.join('')}</dl>` : '',
    meta ? `<p class="railmeet-stop-popup-meta">${escapeHtml(meta)}</p>` : '',
    `</div>`,
  ].join('');
}

function serviceChipHtml(
  service: string,
  mode: string,
  background: string,
  foreground: string,
): string {
  const kind = getMotisModeStyle({ mode: mode || 'OTHER' })[0];
  return `<span class="railmeet-stop-chip" style="background:${escapeHtml(background)};color:${escapeHtml(foreground)}">${modeIconSvg(kind, foreground)}<span>${escapeHtml(service)}</span></span>`;
}

function modeIconSvg(kind: MotisModeIconKind, stroke: string): string {
  const attrs = `class="railmeet-stop-chip-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${escapeHtml(stroke)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  switch (kind) {
    case 'bus':
      return `<svg ${attrs}><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>`;
    case 'tram':
    case 'funicular':
    case 'aerial_lift':
      return `<svg ${attrs}><path d="M10 3h4"/><path d="M12 3v3"/><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 18v3"/><path d="M16 18v3"/><path d="M4 12h16"/></svg>`;
    case 'ship':
      return `<svg ${attrs}><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7"/><path d="M12 10v4"/></svg>`;
    case 'plane':
      return `<svg ${attrs}><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`;
    case 'walk':
    case 'bike':
    case 'cargo_bike':
    case 'scooter':
    case 'seated_scooter':
      return `<svg ${attrs}><path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 2.49-5 5.02-5C9.77 3 11 4.01 11 6.01"/><path d="M13 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M16 20l-4.12-6.12"/><circle cx="4" cy="20" r="1"/><path d="m13.76 7.76 2.24-2.24"/></svg>`;
    case 'train':
    case 'metro':
    default:
      return `<svg ${attrs}><path d="M4 11h16"/><path d="M4 15h16"/><path d="M8 19h8"/><rect x="4" y="3" width="16" height="16" rx="2"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></svg>`;
  }
}

function attachMarkerTooltip(
  marker: InstanceType<MapLibreModule['Marker']>,
  maplibregl: MapLibreModule,
  map: MapInstance,
  text: string,
) {
  const tooltip = new maplibregl.Popup({
    offset: 10,
    closeButton: false,
    closeOnClick: false,
    className: 'railmeet-map-popup railmeet-map-tooltip',
  }).setHTML(`<p class="railmeet-map-popup-title">${escapeHtml(text)}</p>`);
  const el = marker.getElement();
  el.addEventListener('mouseenter', () => {
    tooltip.setLngLat(marker.getLngLat()).addTo(map);
  });
  el.addEventListener('mouseleave', () => {
    tooltip.remove();
  });
}

const DESTINATION_PIN_SVG = `<svg class="railmeet-destination-pin" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>`;

function formatPopupTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'AbortError')
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function markerAriaLabel(item: MapOriginMarker | MapCandidateMarker): string {
  if (item.kind === 'origin') {
    return `Traveler ${item.letter}: ${item.label}`;
  }
  return item.selected
    ? `Selected meeting point rank ${item.rank}: ${item.label}`
    : `Meeting point rank ${item.rank}: ${item.label}`;
}

/** Teal meeting-point fill — matches the MapLibre `meeting` stop circle. */
export const SEARCH_MAP_MEETING_MARKER_COLOR = '#0f766e';

/**
 * Inline styles for meeting-point candidate HTML markers.
 * Selected: MapPin. Non-selected: compact square rank pins.
 */
export function candidateMarkerStyle(item: MapCandidateMarker): string {
  if (item.selected) {
    return [
      'background:transparent;border:0;padding:0;cursor:pointer;z-index:6;',
      'display:grid;place-items:end center;',
    ].join('');
  }
  const size = 28;
  return [
    `width:${size}px;height:${size}px;border-radius:8px;border:2px solid #fff;z-index:3;`,
    'background:#152033;color:#fff;font:700 12px/1 ui-sans-serif,system-ui;',
    'display:grid;place-items:center;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25);',
  ].join('');
}

function markerStyle(item: MapCandidateMarker): string {
  return candidateMarkerStyle(item);
}

export const SEARCH_MAP_ROUTE_LAYER_IDS = ROUTE_LAYER_IDS;
export const SEARCH_MAP_ROUTE_SOURCE_ID = ROUTE_SOURCE_ID;
export const SEARCH_MAP_ROUTE_STOP_SOURCE_ID = ROUTE_STOP_SOURCE_ID;
export const SEARCH_MAP_ROUTE_STOP_LAYER_IDS = ROUTE_STOP_LAYER_IDS;
export const SEARCH_MAP_ROUTE_STOP_HIT_LAYER_ID = ROUTE_STOP_HIT_LAYER_ID;
export const SEARCH_MAP_ROUTE_STOP_RING_LAYER_ID = ROUTE_STOP_RING_LAYER_ID;
export const SEARCH_MAP_ROUTE_STOP_CIRCLE_LAYER_ID = ROUTE_STOP_CIRCLE_LAYER_ID;
export const SEARCH_MAP_ROUTE_STOP_LABEL_LAYER_ID = ROUTE_STOP_LABEL_LAYER_ID;
export const SEARCH_MAP_ORIGIN_SOURCE_ID = ORIGIN_SOURCE_ID;
export const SEARCH_MAP_ORIGIN_LAYER_IDS = [ORIGIN_CIRCLE_LAYER_ID, ORIGIN_LABEL_LAYER_ID] as const;
export const SEARCH_MAP_STATION_SOURCE_ID = STATION_SOURCE_ID;
export const SEARCH_MAP_STATION_LAYER_IDS = [
  STATION_CLUSTER_LAYER_ID,
  STATION_CLUSTER_COUNT_LAYER_ID,
  STATION_POINT_LAYER_ID,
  STATION_LABEL_LAYER_ID,
] as const;
export const SEARCH_MAP_TERRAIN_SOURCE_ID = TERRAIN_SOURCE_ID;
export const SEARCH_MAP_HILLSHADE_LAYER_ID = HILLSHADE_LAYER_ID;
export const SEARCH_MAP_BASEMAP_RAIL_LAYER_IDS = BASEMAP_RAIL_LINE_IDS;
export const SEARCH_MAP_BASEMAP_PLACE_LABEL_IDS = BASEMAP_PLACE_LABEL_IDS;
export const SEARCH_MAP_STATION_FETCH_ZOOM_MIN = STATION_FETCH_ZOOM_MIN;
