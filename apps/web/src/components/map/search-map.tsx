'use client';

import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

import { motisPlanModeLabel } from '@railmeet/shared';

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
  routeStopsToGeoJson,
} from '@/lib/map-markers';
import { ensureMapLibreWorker } from '@/lib/ensure-maplibre-worker';
import {
  fetchMapStops,
  isMapStopsViewportEligible,
  mapStopsQueryFromBounds,
} from '@/lib/map-stops-client';
import { formatArrivalSpreadMs, formatDurationMinutes } from '@/lib/search-view-model';
import { cn } from '@/lib/utils';

/** OpenFreeMap Liberty — open style with required attribution. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

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

/** Inspected OpenFreeMap Liberty rail line layer IDs (do not invent). */
const BASEMAP_RAIL_LINE_IDS = [
  'road_major_rail',
  'road_major_rail_hatching',
  'road_transit_rail',
  'road_transit_rail_hatching',
  'bridge_major_rail',
  'bridge_major_rail_hatching',
  'bridge_transit_rail',
  'bridge_transit_rail_hatching',
  'tunnel_major_rail',
  'tunnel_major_rail_hatching',
  'tunnel_transit_rail',
  'tunnel_transit_rail_hatching',
] as const;

/** Inspected OpenFreeMap Liberty place/country label layer IDs. */
const BASEMAP_PLACE_LABEL_IDS = [
  'label_city',
  'label_city_capital',
  'label_town',
  'label_village',
  'label_state',
  'label_country_1',
  'label_country_2',
  'label_country_3',
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
type MapLibreExpression = import('maplibre-gl').ExpressionSpecification;

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
  const routeHandlersBoundRef = useRef(false);
  const routeStopHandlersBoundRef = useRef(false);
  const stationHandlersBoundRef = useRef(false);
  const stationRequestSeqRef = useRef(0);
  const stationAbortRef = useRef<AbortController | null>(null);
  const stationViewportKeyRef = useRef<string | null>(null);
  const stationCacheRef = useRef(new Map<string, GeoJsonFeatureCollection>());
  const onCandidateSelectRef = useRef(onCandidateSelect);
  const onTravelerSelectRef = useRef(onTravelerSelect);
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
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
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
        ensureRouteStopLayers(map);
        ensureOriginLayers(map);
        bindRouteInteractions(map, maplibregl, onTravelerSelectRef, routeHandlersBoundRef);
        bindRouteStopInteractions(map, maplibregl, routeStopHandlersBoundRef);
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

      let styleReadyHandled = false;
      const onStyleReady = () => {
        if (cancelled || styleReadyHandled) {
          return;
        }
        // Prefer style stylesheet readiness over map.loaded()/isStyleLoaded().
        // OpenFreeMap can paint tiles while image/sprite loading keeps loaded() false forever,
        // which would otherwise skip traveler/station overlays entirely.
        const style = (map as unknown as { style?: { _loaded?: boolean } }).style;
        if (!style?._loaded && !map.getStyle()) {
          return;
        }
        styleReadyHandled = true;
        styleReadyRef.current = true;
        wrapperRef.current?.setAttribute('data-style-ready', '1');
        try {
          enhanceBasemapTransport(map);
          ensureTerrainSupport(map, maplibregl);
          // Defer custom sources slightly so the basemap vector pipeline can start.
          // Custom overlays still apply on the next turn via applyCurrentScene.
          window.setTimeout(() => {
            if (cancelled || mapRef.current !== map) {
              return;
            }
            applyCurrentScene(true);
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
                new maplibregl.Popup({ offset: 12, closeButton: true, maxWidth: '240px' })
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
          styleReadyHandled = false;
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
      routeHandlersBoundRef.current = false;
      routeStopHandlersBoundRef.current = false;
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
    const maplibregl = maplibreglRef.current;
    if (!map || !maplibregl || disabled || !styleReadyRef.current) {
      return;
    }
    ensureStationLayers(map);
    ensureRouteLayers(map);
    ensureRouteStopLayers(map);
    ensureOriginLayers(map);
    bindRouteInteractions(map, maplibregl, onTravelerSelectRef, routeHandlersBoundRef);
    bindRouteStopInteractions(map, maplibregl, routeStopHandlersBoundRef);
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
      className={cn('relative h-full w-full bg-[#d9e2ec]', className)}
      data-testid="search-map"
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
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-[5] max-w-[min(90%,28rem)] -translate-x-1/2 rounded-lg bg-white/90 px-3 py-1.5 text-center text-[11px] text-ink-700 shadow-sm md:left-[calc(50%+200px)]">
          Loading stations…
        </p>
      ) : null}
      {stationStatus === 'zoom' || stationStatus === 'aggregated' ? (
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-[5] max-w-[min(90%,28rem)] -translate-x-1/2 rounded-lg bg-white/90 px-3 py-1.5 text-center text-[11px] text-ink-700 shadow-sm md:left-[calc(50%+200px)]">
          {stationStatus === 'aggregated'
            ? 'Zoom in to view individual stations'
            : 'Zoom in to view stations in this area'}
        </p>
      ) : null}
      {stationStatus === 'error' ? (
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-[5] max-w-[min(90%,28rem)] -translate-x-1/2 rounded-lg bg-white/90 px-3 py-1.5 text-center text-[11px] text-amber-800 shadow-sm md:left-[calc(50%+200px)]">
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

function enhanceBasemapTransport(map: MapInstance) {
  for (const layerId of BASEMAP_RAIL_LINE_IDS) {
    if (!map.getLayer(layerId)) {
      continue;
    }
    try {
      map.setLayoutProperty(layerId, 'visibility', 'visible');
      // Stock Liberty rails are near-invisible (#bbb, width≈0 until z14). Strengthen mid-zoom context.
      if (layerId.endsWith('_hatching')) {
        map.setPaintProperty(layerId, 'line-color', '#6b7280');
        map.setPaintProperty(layerId, 'line-opacity', 0.75);
        map.setPaintProperty(layerId, 'line-width', [
          'interpolate',
          ['exponential', 1.3],
          ['zoom'],
          7,
          0.6,
          11,
          1.4,
          14,
          2.4,
          18,
          5,
        ]);
      } else {
        map.setPaintProperty(layerId, 'line-color', '#4b5563');
        map.setPaintProperty(layerId, 'line-opacity', 0.95);
        map.setPaintProperty(layerId, 'line-width', [
          'interpolate',
          ['exponential', 1.3],
          ['zoom'],
          7,
          0.9,
          11,
          1.8,
          14,
          2.6,
          18,
          4,
        ]);
      }
    } catch {
      // Keep stock layer.
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
      map.setPaintProperty(layerId, 'text-halo-color', '#ffffff');
    } catch {
      // Keep stock labels.
    }
  }

  if (map.getLayer('poi_transit')) {
    try {
      map.setLayoutProperty('poi_transit', 'visibility', 'visible');
      map.setPaintProperty('poi_transit', 'icon-opacity', 0.9);
      map.setPaintProperty('poi_transit', 'text-opacity', 0.95);
      map.setPaintProperty('poi_transit', 'text-halo-width', 1.2);
    } catch {
      // Keep stock POI styling.
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
    ...ROUTE_STOP_LAYER_IDS,
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

function bindRouteInteractions(
  map: MapInstance,
  maplibregl: MapLibreModule,
  onTravelerSelectRef: { current: ((participantId: string | null) => void) | undefined },
  boundRef: { current: boolean },
) {
  if (boundRef.current) {
    return;
  }
  boundRef.current = true;

  const onClick = (event: {
    lngLat?: { lng: number; lat: number };
    features?: Array<{ properties?: Record<string, unknown> | null }>;
  }) => {
    const props = event.features?.[0]?.properties;
    const participantId =
      (typeof props?.participantId === 'string' && props.participantId) ||
      (typeof props?.travelerId === 'string' && props.travelerId) ||
      null;
    if (participantId) {
      onTravelerSelectRef.current?.(participantId);
    }
    if (props && props.style === 'transit' && event.lngLat) {
      new maplibregl.Popup({
        offset: 8,
        closeButton: true,
        maxWidth: '280px',
        className: 'railmeet-map-popup',
      })
        .setLngLat([event.lngLat.lng, event.lngLat.lat])
        .setHTML(routeSegmentPopupHtml(props))
        .addTo(map);
    }
  };
  const onEnter = () => {
    map.getCanvas().style.cursor = 'pointer';
  };
  const onLeave = () => {
    map.getCanvas().style.cursor = '';
  };

  for (const layerId of [ROUTE_TRANSIT_LAYER_ID, ROUTE_WALK_LAYER_ID, ORIGIN_CIRCLE_LAYER_ID]) {
    map.on('click', layerId, onClick as never);
    map.on('mouseenter', layerId, onEnter);
    map.on('mouseleave', layerId, onLeave);
  }
}

/**
 * Opacity for route-stop circles and rings when a traveler journey is de-emphasized.
 */
function stopEmphasisOpacity(dimmed: number): MapLibreExpression {
  return ['case', ['get', 'emphasized'], 1, dimmed];
}

function stopCircleRadius(): MapLibreExpression {
  const emphasis: MapLibreExpression = ['case', ['get', 'emphasized'], 1, 0.35];
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    [
      '*',
      [
        'match',
        ['get', 'role'],
        'meeting',
        10,
        'origin-station',
        8,
        'transfer',
        8,
        'intermediate',
        4,
        5,
      ],
      emphasis,
    ],
    14,
    [
      '*',
      [
        'match',
        ['get', 'role'],
        'meeting',
        14,
        'origin-station',
        11,
        'transfer',
        11,
        'intermediate',
        6,
        7,
      ],
      emphasis,
    ],
  ];
}

/**
 * Intermediate names appear only when showLabel is true; important roles stay visible.
 */
function routeStopLabelTextOpacity(): MapLibreExpression {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    11.5,
    ['case', ['get', 'showLabel'], stopEmphasisOpacity(0.35), 0],
    13,
    stopEmphasisOpacity(0.35),
  ];
}

function routeStopLabelHaloWidth(): MapLibreExpression {
  return ['interpolate', ['linear'], ['zoom'], 11, 2.4, 13, 3, 16, 3.4];
}

function routeStopLabelLayout(): Record<string, unknown> {
  return {
    'text-field': ['get', 'name'],
    'text-size': ['match', ['get', 'role'], 'meeting', 12, 'intermediate', 11, 11.5],
    'text-line-height': 1.1,
    'text-font': ['Noto Sans Bold'],
    'text-variable-anchor': [
      'top',
      'bottom',
      'left',
      'right',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ],
    'text-radial-offset': 1.05,
    'text-justify': 'center',
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'symbol-sort-key': ['*', ['get', 'labelPriority'], -1],
  };
}

function applyRouteStopLabelStyle(map: MapInstance) {
  if (!map.getLayer(ROUTE_STOP_LABEL_LAYER_ID)) {
    return;
  }
  try {
    map.setLayoutProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-field', ['get', 'name']);
    map.setLayoutProperty(
      ROUTE_STOP_LABEL_LAYER_ID,
      'text-size',
      ['match', ['get', 'role'], 'meeting', 12, 'intermediate', 11, 11.5],
    );
    map.setLayoutProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-line-height', 1.1);
    map.setLayoutProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-font', ['Noto Sans Bold']);
    map.setLayoutProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-variable-anchor', [
      'top',
      'bottom',
      'left',
      'right',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ]);
    map.setLayoutProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-radial-offset', 1.05);
    map.setLayoutProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-justify', 'center');
    map.setLayoutProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-allow-overlap', true);
    map.setLayoutProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-ignore-placement', true);
    map.setLayoutProperty(ROUTE_STOP_LABEL_LAYER_ID, 'symbol-sort-key', [
      '*',
      ['get', 'labelPriority'],
      -1,
    ]);
    map.setPaintProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-color', ['get', 'textColor']);
    map.setPaintProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-halo-color', ['get', 'labelBackgroundColor']);
    map.setPaintProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-halo-width', routeStopLabelHaloWidth());
    map.setPaintProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-halo-blur', 0);
    map.setPaintProperty(ROUTE_STOP_LABEL_LAYER_ID, 'text-opacity', routeStopLabelTextOpacity());
  } catch {
    // Keep existing style if the runtime rejects the update.
  }
}

function routeStopLabelPaint(): Record<string, unknown> {
  return {
    'text-color': ['get', 'textColor'],
    'text-halo-color': ['get', 'labelBackgroundColor'],
    'text-halo-width': routeStopLabelHaloWidth(),
    'text-halo-blur': 0,
    'text-opacity': routeStopLabelTextOpacity(),
  };
}

function applyRouteStopLabelPaint(map: MapInstance) {
  applyRouteStopLabelStyle(map);
}

function ensureRouteStopLayers(map: MapInstance) {
  if (!map.getSource(ROUTE_STOP_SOURCE_ID)) {
    map.addSource(ROUTE_STOP_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(ROUTE_STOP_HIT_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_STOP_HIT_LAYER_ID,
      type: 'circle',
      source: ROUTE_STOP_SOURCE_ID,
      paint: {
        'circle-radius': 15,
        'circle-color': '#000000',
        'circle-opacity': 0,
        'circle-stroke-opacity': 0,
      },
    });
  }
  if (!map.getLayer(ROUTE_STOP_RING_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_STOP_RING_LAYER_ID,
      type: 'circle',
      source: ROUTE_STOP_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'transfer'], ['!=', ['get', 'ringColor'], '']],
      paint: {
        'circle-radius': 11,
        'circle-color': '#ffffff',
        'circle-opacity': 0,
        'circle-stroke-width': 3,
        'circle-stroke-color': ['get', 'ringColor'],
        'circle-stroke-opacity': stopEmphasisOpacity(0.35),
      },
    });
  }
  if (!map.getLayer(ROUTE_STOP_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_STOP_CIRCLE_LAYER_ID,
      type: 'circle',
      source: ROUTE_STOP_SOURCE_ID,
      paint: {
        'circle-radius': stopCircleRadius(),
        'circle-color': [
          'match',
          ['get', 'role'],
          'meeting',
          '#0f766e',
          'origin-station',
          ['get', 'borderColor'],
          '#ffffff',
        ],
        'circle-stroke-width': [
          'match',
          ['get', 'role'],
          'meeting',
          3,
          'origin-station',
          2.5,
          'transfer',
          2.5,
          2,
        ],
        'circle-stroke-color': [
          'match',
          ['get', 'role'],
          'meeting',
          '#ffffff',
          'origin-station',
          '#ffffff',
          ['get', 'borderColor'],
        ],
        'circle-opacity': stopEmphasisOpacity(0.35),
        'circle-stroke-opacity': stopEmphasisOpacity(0.35),
      },
    });
  }
  if (!map.getLayer(ROUTE_STOP_LABEL_LAYER_ID)) {
    try {
      map.addLayer({
        id: ROUTE_STOP_LABEL_LAYER_ID,
        type: 'symbol',
        source: ROUTE_STOP_SOURCE_ID,
        filter: ['==', ['get', 'showLabel'], true],
        layout: routeStopLabelLayout(),
        paint: routeStopLabelPaint(),
      });
    } catch {
      // Optional labels — circles and click popups still work without glyphs.
    }
    return;
  }
  applyRouteStopLabelPaint(map);
}

function bindRouteStopInteractions(
  map: MapInstance,
  maplibregl: MapLibreModule,
  boundRef: { current: boolean },
) {
  if (boundRef.current) {
    return;
  }
  boundRef.current = true;

  const onStopClick = (event: {
    originalEvent?: { stopPropagation?: () => void };
    lngLat: { lng: number; lat: number };
    features?: Array<{ properties?: Record<string, unknown> | null }>;
  }) => {
    event.originalEvent?.stopPropagation?.();
    const props = event.features?.[0]?.properties;
    if (!props) {
      return;
    }
    new maplibregl.Popup({
      offset: 14,
      closeButton: true,
      maxWidth: '260px',
      className: 'railmeet-map-popup',
    })
      .setLngLat([event.lngLat.lng, event.lngLat.lat])
      .setHTML(stopFeaturePopupHtml(props))
      .addTo(map);
  };
  const onEnter = () => {
    map.getCanvas().style.cursor = 'pointer';
  };
  const onLeave = () => {
    map.getCanvas().style.cursor = '';
  };

  map.on('click', ROUTE_STOP_HIT_LAYER_ID, onStopClick as never);
  map.on('mouseenter', ROUTE_STOP_HIT_LAYER_ID, onEnter);
  map.on('mouseleave', ROUTE_STOP_HIT_LAYER_ID, onLeave);
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

  const routeStopSource = map.getSource(ROUTE_STOP_SOURCE_ID) as
    | { setData: (data: ReturnType<typeof routeStopsToGeoJson>) => void }
    | undefined;
  if (routeStopSource) {
    routeStopSource.setData(routeStopsToGeoJson(scene));
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
  // Route stops are drawn entirely by the MapLibre circle/symbol layers above.
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
    el.textContent = item.selected ? '' : String(item.rank);

    el.addEventListener('click', () => {
      onCandidateSelectRef.current?.(item.id.replace(/^candidate:/, ''));
    });

    const popup = new maplibregl.Popup({
      offset: 14,
      closeButton: true,
      maxWidth: '260px',
      className: 'railmeet-map-popup',
    }).setHTML(meetingPopupHtml(item));

    const marker = new maplibregl.Marker({
      element: el,
      anchor: 'center',
      pitchAlignment: 'viewport',
    })
      .setLngLat([item.longitude, item.latitude])
      .setPopup(popup)
      .addTo(map);
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
      maxWidth: '260px',
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

function stopFeaturePopupHtml(properties: Record<string, unknown>): string {
  const text = (key: string): string => {
    const value = properties[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const name = text('name');
  const role = text('role') as MapStopMarker['role'];
  const roleLabel = STOP_ROLE_LABELS[role] ?? 'Stop';
  const letter = text('letter');
  const rows = [
    `<strong>${escapeHtml(name)}</strong>`,
    `<div>${escapeHtml(roleLabel)}${letter ? ` · Traveler ${escapeHtml(letter)}` : ''}</div>`,
  ];
  const arrivalAt = text('arrivalAt');
  if (arrivalAt) {
    rows.push(`<div>Arrives ${escapeHtml(formatPopupTime(arrivalAt))}</div>`);
  }
  const departureAt = text('departureAt');
  if (departureAt) {
    rows.push(`<div>Departs ${escapeHtml(formatPopupTime(departureAt))}</div>`);
  }
  const track = text('track');
  if (track) {
    rows.push(`<div>Track ${escapeHtml(track)}</div>`);
  }
  const arrivingService = text('arrivingService');
  if (arrivingService) {
    rows.push(`<div>Arriving service ${escapeHtml(arrivingService)}</div>`);
  }
  const departingService = text('departingService');
  if (departingService) {
    rows.push(`<div>Departing service ${escapeHtml(departingService)}</div>`);
  }
  return rows.join('');
}

function routeSegmentPopupHtml(properties: Record<string, unknown>): string {
  const text = (key: string): string => {
    const value = properties[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const rows = [`<strong>${escapeHtml(text('serviceLabel') || text('mode'))}</strong>`];
  const modeLabel = motisPlanModeLabel(text('motisMode') || text('mode'));
  rows.push(`<div>${escapeHtml(modeLabel)}</div>`);
  const displayName = text('displayName');
  if (displayName && displayName !== text('serviceLabel')) {
    rows.push(`<div>${escapeHtml(displayName)}</div>`);
  }
  const routeShortName = text('routeShortName');
  if (routeShortName) {
    rows.push(`<div>Line ${escapeHtml(routeShortName)}</div>`);
  }
  const tripShortName = text('tripShortName');
  if (tripShortName) {
    rows.push(`<div>Trip ${escapeHtml(tripShortName)}</div>`);
  }
  const agencyName = text('agencyName');
  if (agencyName) {
    rows.push(`<div>${escapeHtml(agencyName)}</div>`);
  }
  const headsign = text('headsign');
  if (headsign) {
    rows.push(`<div>Toward ${escapeHtml(headsign)}</div>`);
  }
  const fromName = text('fromName');
  if (fromName) {
    rows.push(`<div>Board ${escapeHtml(fromName)}</div>`);
  }
  const toName = text('toName');
  if (toName) {
    rows.push(`<div>Alight ${escapeHtml(toName)}</div>`);
  }
  const departureAt = text('departureAt');
  if (departureAt) {
    rows.push(`<div>Departs ${escapeHtml(formatPopupTime(departureAt))}</div>`);
  }
  const arrivalAt = text('arrivalAt');
  if (arrivalAt) {
    rows.push(`<div>Arrives ${escapeHtml(formatPopupTime(arrivalAt))}</div>`);
  }
  const stops = properties.intermediateStopCount;
  if (typeof stops === 'number' && Number.isFinite(stops)) {
    rows.push(`<div>${stops} intermediate ${stops === 1 ? 'stop' : 'stops'}</div>`);
  }
  return rows.join('');
}

function travelerPopupHtml(item: MapOriginMarker): string {
  const popup = item.popup;
  if (!popup) {
    return `<strong>${escapeHtml(item.label)}</strong><div>Origin · Traveler ${escapeHtml(item.letter)}</div>`;
  }
  return travelerSummaryHtml(popup);
}

function travelerSummaryHtml(popup: MapTravelerPopup): string {
  return [
    `<strong>${escapeHtml(popup.displayName)}</strong>`,
    `<div>Traveler ${escapeHtml(popup.letter)} · ${escapeHtml(popup.originLabel)}</div>`,
    `<div>Departs ${escapeHtml(formatPopupTime(popup.departureAt))}</div>`,
    `<div>Arrives ${escapeHtml(formatPopupTime(popup.arrivalAt))}</div>`,
    `<div>${escapeHtml(formatDurationMinutes(popup.durationMinutes))} · ${popup.transfers} transfers</div>`,
  ].join('');
}

function meetingPopupHtml(item: MapCandidateMarker): string {
  const popup = item.popup;
  if (!popup) {
    return `<strong>${escapeHtml(item.label)}</strong><div>Rank ${item.rank}</div>`;
  }
  return [
    `<strong>${escapeHtml(popup.name)}</strong>`,
    `<div>Meeting point · Rank ${popup.rank}</div>`,
    `<div>Arrivals ${escapeHtml(formatPopupTime(popup.earliestArrivalAt))} – ${escapeHtml(formatPopupTime(popup.latestArrivalAt))}</div>`,
    `<div>Spread ${escapeHtml(formatArrivalSpreadMs(popup.arrivalSpreadMs))}</div>`,
  ].join('');
}

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
 * Selected: largest teal circle with white stroke (stop-marker hierarchy).
 * Non-selected: compact square rank pins.
 */
export function candidateMarkerStyle(item: MapCandidateMarker): string {
  if (item.selected) {
    const size = 40;
    return [
      `width:${size}px;height:${size}px;border-radius:999px;border:3px solid #ffffff;z-index:4;`,
      `background:${SEARCH_MAP_MEETING_MARKER_COLOR};color:#ffffff;`,
      'display:grid;place-items:center;cursor:pointer;',
      'box-shadow:0 2px 6px rgba(15,118,110,0.35);padding:0;',
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
