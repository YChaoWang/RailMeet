'use client';

import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { MapScene } from '@/lib/map-markers';
import { cn } from '@/lib/utils';

/** OpenFreeMap Liberty — open style with required attribution. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const ROUTE_SOURCE_ID = 'railmeet-selected-routes';
const ROUTE_CASING_LAYER_ID = 'railmeet-selected-routes-casing';
const ROUTE_TRANSIT_LAYER_ID = 'railmeet-selected-routes-transit';
const ROUTE_WALK_LAYER_ID = 'railmeet-selected-routes-walk';

type SearchMapProps = {
  readonly scene: MapScene;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onCandidateSelect?: (candidateId: string) => void;
};

type MapLibreModule = typeof import('maplibre-gl');

/**
 * Client-only MapLibre map.
 * Route layers use decoded persisted geometry only — never fabricated straight lines.
 */
export function SearchMap({
  scene,
  className,
  disabled = false,
  onCandidateSelect,
}: SearchMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<InstanceType<MapLibreModule['Map']> | null>(null);
  const markersRef = useRef<InstanceType<MapLibreModule['Marker']>[]>([]);
  const maplibreglRef = useRef<MapLibreModule | null>(null);
  const onCandidateSelectRef = useRef<((candidateId: string) => void) | undefined>(undefined);
  onCandidateSelectRef.current = onCandidateSelect;

  useEffect(() => {
    if (disabled || typeof window === 'undefined' || !containerRef.current) {
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    void (async () => {
      const maplibregl = await import('maplibre-gl');
      if (cancelled || !containerRef.current) {
        return;
      }
      maplibreglRef.current = maplibregl;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: [10.0, 50.0],
        zoom: 4.2,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      // Keep attribution above the mobile bottom sheet and clear of the desktop panel.
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
      mapRef.current = map;
      resizeObserver = new ResizeObserver(() => {
        map.resize();
      });
      resizeObserver.observe(containerRef.current);
      map.on('load', () => {
        ensureRouteLayers(map);
        applyScene(maplibregl, map, scene, markersRef, onCandidateSelectRef);
      });
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      clearMarkers(markersRef);
      const map = mapRef.current;
      if (map) {
        removeRouteLayers(map);
        map.remove();
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreglRef.current;
    if (!map || !maplibregl || disabled) {
      return;
    }
    const apply = () => {
      ensureRouteLayers(map);
      applyScene(maplibregl, map, scene, markersRef, onCandidateSelectRef);
    };
    if (!map.isStyleLoaded()) {
      map.once('load', apply);
      return;
    }
    apply();
  }, [scene, disabled]);

  return (
    <div
      ref={containerRef}
      className={cn('h-full w-full bg-[#d9e2ec]', className)}
      data-testid="search-map"
      data-marker-count={scene.markers.length}
      data-route-line-count={scene.routeLines.length}
      data-route-segment-count={scene.routeLines.length}
      role="img"
      aria-label="Map of traveler origins, meeting candidates, and selected transit routes"
    />
  );
}

function clearMarkers(markersRef: { current: InstanceType<MapLibreModule['Marker']>[] }) {
  for (const marker of markersRef.current) {
    marker.remove();
  }
  markersRef.current = [];
}

function ensureRouteLayers(map: InstanceType<MapLibreModule['Map']>) {
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
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
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
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });
  }
  if (!map.getLayer(ROUTE_WALK_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_WALK_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'style'], 'walk'],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['get', 'emphasized'], 4, 2.5],
        'line-opacity': ['case', ['get', 'emphasized'], 0.95, 0.3],
        'line-dasharray': [1.2, 1.6],
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });
  }
}

function removeRouteLayers(map: InstanceType<MapLibreModule['Map']>) {
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
    geometry: {
      type: 'LineString';
      coordinates: Array<[number, number]>;
    };
  }>;
};

function emptyFeatureCollection(): RouteFeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function applyScene(
  maplibregl: MapLibreModule,
  map: InstanceType<MapLibreModule['Map']>,
  scene: MapScene,
  markersRef: { current: InstanceType<MapLibreModule['Marker']>[] },
  onCandidateSelectRef: { current: ((candidateId: string) => void) | undefined },
) {
  clearMarkers(markersRef);

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
          color: segment.color,
          style: segment.style,
          emphasized: segment.emphasized,
          letter: segment.letter,
          mode: segment.mode,
        },
        geometry: {
          type: 'LineString',
          coordinates: segment.coordinates.map((pair) => [pair[0], pair[1]]),
        },
      })),
    });
  }

  const bounds = new maplibregl.LngLatBounds();
  let hasBounds = false;

  for (const segment of scene.routeLines) {
    for (const [longitude, latitude] of segment.coordinates) {
      bounds.extend([longitude, latitude]);
      hasBounds = true;
    }
  }

  for (const item of scene.markers) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'railmeet-map-marker';
    el.setAttribute('aria-label', markerAriaLabel(item));
    el.style.cssText = markerStyle(item);
    el.textContent =
      item.kind === 'origin' ? item.letter : item.kind === 'transfer' ? '↔' : String(item.rank);
    if (item.kind === 'candidate') {
      el.addEventListener('click', () => {
        onCandidateSelectRef.current?.(item.id.replace(/^candidate:/, ''));
      });
    }

    const marker = new maplibregl.Marker({
      element: el,
      anchor: 'center',
      // Keep markers above route lines.
      pitchAlignment: 'viewport',
    })
      .setLngLat([item.longitude, item.latitude])
      .setPopup(
        new maplibregl.Popup({ offset: 12, closeButton: false }).setText(
          item.kind === 'origin'
            ? item.label
            : item.kind === 'transfer'
              ? `Traveler ${item.letter} transfer`
              : `${item.label} · Rank ${item.rank}`,
        ),
      )
      .addTo(map);
    markersRef.current.push(marker);
    bounds.extend([item.longitude, item.latitude]);
    hasBounds = true;
  }

  if (hasBounds) {
    map.fitBounds(bounds, {
      padding: { top: 56, bottom: 72, left: 56, right: 56 },
      maxZoom: 12,
      duration: 450,
    });
  }
}

function markerAriaLabel(item: MapScene['markers'][number]): string {
  if (item.kind === 'origin') {
    return `Traveler ${item.letter}: ${item.label}`;
  }
  if (item.kind === 'transfer') {
    return `Traveler ${item.letter} transfer`;
  }
  return item.selected
    ? `Selected meeting point rank ${item.rank}: ${item.label}`
    : `Meeting point rank ${item.rank}: ${item.label}`;
}

function markerStyle(item: MapScene['markers'][number]): string {
  if (item.kind === 'origin') {
    return [
      'width:28px;height:28px;border-radius:999px;border:2px solid #fff;z-index:2;',
      `background:${item.color};color:#fff;font:600 12px/1 system-ui;`,
      'display:grid;place-items:center;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25);',
    ].join('');
  }
  if (item.kind === 'transfer') {
    return [
      'width:14px;height:14px;border-radius:999px;border:2px solid #fff;z-index:2;',
      `background:${item.color};color:#fff;font:700 8px/1 system-ui;`,
      'display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.2);',
    ].join('');
  }
  const size = item.selected ? 34 : 28;
  const bg = item.selected ? '#0f766e' : '#152033';
  return [
    `width:${size}px;height:${size}px;border-radius:8px;border:2px solid #fff;z-index:3;`,
    `background:${bg};color:#fff;font:700 12px/1 system-ui;`,
    'display:grid;place-items:center;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.25);',
  ].join('');
}

/** Test seam: route layer ids used by MapLibre. */
export const SEARCH_MAP_ROUTE_LAYER_IDS = [
  ROUTE_CASING_LAYER_ID,
  ROUTE_TRANSIT_LAYER_ID,
  ROUTE_WALK_LAYER_ID,
] as const;

export const SEARCH_MAP_ROUTE_SOURCE_ID = ROUTE_SOURCE_ID;
