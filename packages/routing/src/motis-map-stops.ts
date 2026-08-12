import {
  MAP_STOPS_IMPORTANCE_MAJOR_MIN,
  MAP_STOPS_IMPORTANCE_REGIONAL_MIN,
  PLACE_NAME_MAX_LENGTH,
  PROVIDER_PLACE_ID_MAX_LENGTH,
} from '@railmeet/shared';
import { z } from 'zod';

import { RoutingError } from './errors.js';
import type {
  StationFeature,
  StationFeatureCollection,
  StationImportance,
  StationKind,
} from './types.js';

/** MOTIS OpenAPI pin for map stops (Transitous /api/v1/map/stops). */
export const MOTIS_MAP_STOPS_OPENAPI_PIN = 'motis:/api/v1/map/stops';
export const MOTIS_MAP_STOPS_API_VERSION = 'v1';

const motisMapStopPlaceSchema = z
  .object({
    name: z.string().min(1).max(PLACE_NAME_MAX_LENGTH),
    stopId: z.string().min(1).max(PROVIDER_PLACE_ID_MAX_LENGTH),
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
    importance: z.number().finite().optional(),
    modes: z.array(z.string()).optional(),
    parentId: z.string().min(1).max(PROVIDER_PLACE_ID_MAX_LENGTH).optional().nullable(),
  })
  .passthrough();

export const motisMapStopsResponseSchema = z.array(motisMapStopPlaceSchema);

const KIND_PRIORITY: Record<StationKind, number> = {
  rail: 0,
  metro: 1,
  tram: 2,
  ferry: 3,
  bus: 4,
  other: 5,
};

import { mapMotisLegMode } from './motis-mode.js';

function mapModeToKind(mode: string): StationKind {
  const mapped = mapMotisLegMode(mode);
  switch (mapped) {
    case 'train':
      return 'rail';
    case 'metro':
      return 'metro';
    case 'tram':
      return 'tram';
    case 'ferry':
      return 'ferry';
    case 'bus':
      return 'bus';
    default:
      return 'other';
  }
}

/**
 * Choose a single display kind from MOTIS modes.
 * Prefers rail-family modes for RailMeet's rail-first map context.
 */
export function stationKindFromModes(modes: readonly string[]): StationKind {
  let best: StationKind = 'other';
  for (const mode of modes) {
    const kind = mapModeToKind(mode);
    if (KIND_PRIORITY[kind] < KIND_PRIORITY[best]) {
      best = kind;
    }
  }
  return best;
}

export function stationImportanceFromScore(score: number | undefined): StationImportance {
  const value = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  if (value >= MAP_STOPS_IMPORTANCE_MAJOR_MIN) {
    return 'major';
  }
  if (value >= MAP_STOPS_IMPORTANCE_REGIONAL_MIN) {
    return 'regional';
  }
  return 'local';
}

function emptyCollection(sourceFeatureCount = 0): StationFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
    metadata: {
      truncated: false,
      aggregated: false,
      minimumDetailZoom: null,
      sourceFeatureCount,
    },
  };
}

/**
 * Normalize a MOTIS Place array from `/v1/map/stops` into a GeoJSON FeatureCollection.
 * Deduplicates by stopId (first occurrence wins after importance preference).
 */
export function normalizeMotisMapStopsResponse(payload: unknown): StationFeatureCollection {
  const parsed = motisMapStopsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new RoutingError(
      'PROVIDER_CONTRACT_FAILURE',
      'provider_contract',
      'Provider map stops response failed schema validation',
      { cause: parsed.error },
    );
  }

  if (parsed.data.length === 0) {
    return emptyCollection(0);
  }

  const byStopId = new Map<
    string,
    {
      readonly feature: StationFeature;
      readonly importanceScore: number;
    }
  >();

  for (const place of parsed.data) {
    const stopId = place.stopId.trim();
    const name = place.name.trim();
    if (stopId.length === 0 || name.length === 0) {
      continue;
    }

    const modes = (place.modes ?? []).map((mode) => mode.trim()).filter((mode) => mode.length > 0);
    const importanceScore = place.importance ?? 0;
    const feature: StationFeature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [place.lon, place.lat],
      },
      properties: {
        stopId,
        name,
        kind: stationKindFromModes(modes),
        importance: stationImportanceFromScore(importanceScore),
        modes,
        parentId: place.parentId?.trim() ? place.parentId.trim() : null,
      },
    };

    const existing = byStopId.get(stopId);
    if (!existing || importanceScore > existing.importanceScore) {
      byStopId.set(stopId, { feature, importanceScore });
    }
  }

  const features = [...byStopId.values()]
    .map((entry) => entry.feature)
    .sort((left, right) => {
      const importanceOrder: Record<StationImportance, number> = {
        major: 0,
        regional: 1,
        local: 2,
      };
      const importanceCmp =
        importanceOrder[left.properties.importance] - importanceOrder[right.properties.importance];
      if (importanceCmp !== 0) {
        return importanceCmp;
      }
      const kindCmp = KIND_PRIORITY[left.properties.kind] - KIND_PRIORITY[right.properties.kind];
      if (kindCmp !== 0) {
        return kindCmp;
      }
      return left.properties.name.localeCompare(right.properties.name);
    });

  return {
    type: 'FeatureCollection',
    features,
    metadata: {
      truncated: false,
      aggregated: false,
      minimumDetailZoom: null,
      sourceFeatureCount: features.length,
    },
  };
}
