import type { MapStopsQuery, StationFeatureCollection } from '@railmeet/validation';
import { stationFeatureCollectionSchema } from '@railmeet/validation';

export type MapStopsClientResult =
  | { readonly ok: true; readonly data: StationFeatureCollection }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

export type MapStopsBounds = {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
};

/**
 * Build a map-stops query from MapLibre-style west/south/east/north bounds.
 * Does not call Transitous — routes through the Next.js API proxy.
 */
export function mapStopsQueryFromBounds(
  bounds: MapStopsBounds,
  zoom: number,
): MapStopsQuery {
  return {
    minLon: bounds.minLon,
    minLat: bounds.minLat,
    maxLon: bounds.maxLon,
    maxLat: bounds.maxLat,
    zoom,
  };
}

export async function fetchMapStops(
  query: MapStopsQuery,
  options?: { readonly signal?: AbortSignal },
): Promise<MapStopsClientResult> {
  const params = new URLSearchParams({
    minLon: String(query.minLon),
    minLat: String(query.minLat),
    maxLon: String(query.maxLon),
    maxLat: String(query.maxLat),
    zoom: String(query.zoom),
  });

  const response = await fetch(`/api/v1/map/stops?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    ...(options?.signal ? { signal: options.signal } : {}),
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      body.error &&
      typeof body.error === 'object'
        ? (body.error as { code?: string; message?: string })
        : null;
    return {
      ok: false,
      error: {
        code: error?.code ?? 'SERVICE_UNAVAILABLE',
        message: error?.message ?? 'Map stations are temporarily unavailable.',
      },
    };
  }

  const envelope = body as { data?: unknown };
  const parsed = stationFeatureCollectionSchema.safeParse(envelope.data);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Map stations response was invalid.',
      },
    };
  }
  return { ok: true, data: parsed.data };
}
