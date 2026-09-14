'use client';

import type { Feature, FeatureCollection, Geometry } from 'geojson';
import * as MapLibreGL from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ensureMapLibreWorker } from '@/lib/ensure-maplibre-worker';
import { cn } from '@/lib/utils';

const blankMapStyle: MapLibreGL.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': 'rgba(0, 0, 0, 0)' },
    },
  ],
};

type Theme = 'light' | 'dark';

function getDocumentTheme(): Theme | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const root = document.documentElement;
  if (root.classList.contains('dark')) {
    return 'dark';
  }
  if (root.classList.contains('light')) {
    return 'light';
  }
  return null;
}

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function useResolvedTheme(themeProp?: Theme): Theme {
  const [detectedTheme, setDetectedTheme] = useState<Theme>(
    () => getDocumentTheme() ?? getSystemTheme(),
  );

  useEffect(() => {
    if (themeProp) {
      return;
    }
    const observer = new MutationObserver(() => {
      const docTheme = getDocumentTheme();
      if (docTheme) {
        setDetectedTheme(docTheme);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = (event: MediaQueryListEvent) => {
      if (!getDocumentTheme()) {
        setDetectedTheme(event.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handleSystemChange);
    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', handleSystemChange);
    };
  }, [themeProp]);

  return themeProp ?? detectedTheme;
}

type MapContextValue = {
  map: MapLibreGL.Map | null;
  isLoaded: boolean;
  resolvedTheme: Theme;
};

const MapContext = createContext<MapContextValue | null>(null);

function useMap() {
  const context = useContext(MapContext);
  if (!context) {
    throw new Error('useMap must be used within a Map component');
  }
  return context;
}

type MapRef = MapLibreGL.Map;

type MapProps = {
  children?: ReactNode;
  className?: string;
  theme?: Theme;
  /** Transparent tile-less canvas — add MapGeoJSON (or other layers) on top. */
  blank?: boolean;
} & Omit<MapLibreGL.MapOptions, 'container' | 'style'>;

const Map = forwardRef<MapRef, MapProps>(function Map(
  { children, className, theme: themeProp, blank = false, ...props },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<MapLibreGL.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const resolvedTheme = useResolvedTheme(themeProp);

  useImperativeHandle(ref, () => mapInstance as MapLibreGL.Map, [mapInstance]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    ensureMapLibreWorker();
    const map = new MapLibreGL.Map({
      container: containerRef.current,
      style: blank ? blankMapStyle : resolvedTheme === 'dark'
        ? 'https://tiles.openfreemap.org/styles/dark'
        : 'https://tiles.openfreemap.org/styles/positron',
      renderWorldCopies: false,
      attributionControl: false,
      cooperativeGestures: true,
      ...props,
    });
    const onLoad = () => setIsLoaded(true);
    map.on('load', onLoad);
    setMapInstance(map);
    return () => {
      map.off('load', onLoad);
      map.remove();
      setIsLoaded(false);
      setMapInstance(null);
    };
    // MapLibre is created once; later prop changes are not a full remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contextValue = useMemo(
    () => ({
      map: mapInstance,
      isLoaded,
      resolvedTheme,
    }),
    [mapInstance, isLoaded, resolvedTheme],
  );

  return (
    <MapContext.Provider value={contextValue}>
      <div ref={containerRef} className={cn('relative h-full w-full', className)}>
        {mapInstance ? children : null}
      </div>
    </MapContext.Provider>
  );
});

type MapFillPaint = NonNullable<MapLibreGL.FillLayerSpecification['paint']>;
type MapLinePaint = NonNullable<MapLibreGL.LineLayerSpecification['paint']>;

type MapGeoJSONData = FeatureCollection | Feature | Geometry | string;

type MapGeoJSONProps = {
  data: MapGeoJSONData;
  id?: string;
  promoteId?: string;
  fillPaint?: MapFillPaint | false;
  linePaint?: MapLinePaint | false;
};

const GEOJSON_DEFAULT_COLORS = {
  light: { fill: '#d4d4d4', line: '#ffffff' },
  dark: { fill: '#404040', line: '#171717' },
} as const;

function MapGeoJSON({
  data,
  id: propId,
  promoteId,
  fillPaint,
  linePaint,
}: MapGeoJSONProps) {
  const { map, isLoaded, resolvedTheme } = useMap();
  const autoId = useId();
  const id = propId ?? autoId;
  const sourceId = `geojson-source-${id}`;
  const fillLayerId = `geojson-fill-${id}`;
  const lineLayerId = `geojson-line-${id}`;
  const defaults = GEOJSON_DEFAULT_COLORS[resolvedTheme];
  const showFill = fillPaint !== false;
  const showLine = linePaint !== false;

  const mergedFillPaint = useMemo(
    () => ({ 'fill-color': defaults.fill, ...(fillPaint || {}) }),
    [defaults.fill, fillPaint],
  );
  const mergedLinePaint = useMemo(
    () => ({
      'line-color': defaults.line,
      'line-width': 0.5,
      ...(linePaint || {}),
    }),
    [defaults.line, linePaint],
  );

  useEffect(() => {
    if (!isLoaded || !map) {
      return;
    }
    const sourceSpec: MapLibreGL.GeoJSONSourceSpecification = {
      type: 'geojson',
      data,
    };
    if (promoteId) {
      sourceSpec.promoteId = promoteId;
    }
    map.addSource(sourceId, sourceSpec);
    return () => {
      try {
        if (map.getLayer(lineLayerId)) {
          map.removeLayer(lineLayerId);
        }
        if (map.getLayer(fillLayerId)) {
          map.removeLayer(fillLayerId);
        }
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
      } catch {
        // Style may be mid-reload.
      }
    };
    // Source identity is stable for the layer lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  useEffect(() => {
    if (!isLoaded || !map) {
      return;
    }
    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined;
    source?.setData(data as never);
  }, [isLoaded, map, data, sourceId]);

  useEffect(() => {
    if (!isLoaded || !map) {
      return;
    }
    if (!map.getSource(sourceId)) {
      return;
    }
    if (showFill && !map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: mergedFillPaint,
      });
    } else if (!showFill && map.getLayer(fillLayerId)) {
      map.removeLayer(fillLayerId);
    }
    if (showLine && !map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: mergedLinePaint,
      });
    } else if (!showLine && map.getLayer(lineLayerId)) {
      map.removeLayer(lineLayerId);
    }
    if (showFill && map.getLayer(fillLayerId)) {
      for (const [key, value] of Object.entries(mergedFillPaint)) {
        map.setPaintProperty(fillLayerId, key as keyof MapFillPaint, value as never);
      }
    }
    if (showLine && map.getLayer(lineLayerId)) {
      for (const [key, value] of Object.entries(mergedLinePaint)) {
        map.setPaintProperty(lineLayerId, key as keyof MapLinePaint, value as never);
      }
    }
  }, [
    isLoaded,
    map,
    sourceId,
    fillLayerId,
    lineLayerId,
    showFill,
    showLine,
    mergedFillPaint,
    mergedLinePaint,
  ]);

  return null;
}

export { Map, MapGeoJSON, useMap };
export type { MapProps, MapGeoJSONProps, MapRef };
