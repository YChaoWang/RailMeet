import { z } from 'zod';

import {
  IANA_TIMEZONE_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
  PLACE_SEARCH_RESULT_LIMIT,
  PROVIDER_PLACE_ID_MAX_LENGTH,
} from '@railmeet/shared';

import { RoutingError } from './errors.js';
import type { PlaceSuggestion } from './types.js';

/** MOTIS OpenAPI pin for geocode (Transitous /api/v1/geocode). */
export const MOTIS_GEOCODE_OPENAPI_PIN = 'motis:/api/v1/geocode';
export const MOTIS_GEOCODE_API_VERSION = 'v1';

const motisLocationTypeSchema = z.enum(['ADDRESS', 'PLACE', 'STOP']);

const motisAreaSchema = z
  .object({
    name: z.string(),
    adminLevel: z.number().finite(),
    matched: z.boolean().optional(),
    unique: z.boolean().optional(),
    default: z.boolean().optional(),
  })
  .passthrough();

const motisMatchSchema = z
  .object({
    type: motisLocationTypeSchema,
    name: z.string().min(1).max(PLACE_NAME_MAX_LENGTH),
    id: z.string().min(1).max(PROVIDER_PLACE_ID_MAX_LENGTH),
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
    country: z.string().optional(),
    tz: z.string().optional(),
    areas: z.array(motisAreaSchema).default([]),
    modes: z.array(z.string()).optional(),
    score: z.number().finite().optional(),
    importance: z.number().finite().optional(),
    category: z.string().optional(),
  })
  .passthrough();

export const motisGeocodeResponseSchema = z.array(motisMatchSchema);

function normalizeCountryCode(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeTimezone(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > IANA_TIMEZONE_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

function typeLabel(type: z.infer<typeof motisLocationTypeSchema>): string {
  switch (type) {
    case 'STOP':
      return 'Station';
    case 'PLACE':
      return 'City';
    case 'ADDRESS':
      return 'Address';
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function secondaryLabel(
  match: z.infer<typeof motisMatchSchema>,
  countryCode: string | null,
): string | null {
  const parts: string[] = [typeLabel(match.type)];
  const defaultArea =
    match.areas.find((area) => area.default) ??
    match.areas.find((area) => area.unique) ??
    match.areas.find((area) => area.adminLevel >= 4 && area.adminLevel <= 8);
  const locality = defaultArea?.name?.trim();
  if (locality && locality.toLowerCase() !== match.name.trim().toLowerCase()) {
    parts.push(countryCode ? `${locality}, ${countryCode}` : locality);
  } else if (countryCode) {
    parts.push(countryCode);
  }
  return parts.join(' · ');
}

function typeRank(type: z.infer<typeof motisLocationTypeSchema>): number {
  // Prefer public-transport stops for meeting-search origins.
  if (type === 'STOP') {
    return 0;
  }
  if (type === 'PLACE') {
    return 1;
  }
  return 2;
}

/**
 * Normalize a MOTIS geocode Match array into RailMeet place suggestions.
 * Provider-only fields beyond the public suggestion contract are dropped.
 */
export function normalizeMotisGeocodeResponse(payload: unknown): readonly PlaceSuggestion[] {
  const parsed = motisGeocodeResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new RoutingError(
      'PROVIDER_CONTRACT_FAILURE',
      'provider_contract',
      'Provider geocode response failed schema validation',
      { cause: parsed.error },
    );
  }

  const suggestions = parsed.data.map((match) => {
    const countryCode = normalizeCountryCode(match.country);
    const suggestion: PlaceSuggestion = {
      providerId: match.id,
      name: match.name.trim(),
      type: match.type,
      latitude: match.lat,
      longitude: match.lon,
      countryCode,
      timezone: normalizeTimezone(match.tz),
      modes: (match.modes ?? []).map((mode) => mode.trim()).filter((mode) => mode.length > 0),
      secondaryLabel: secondaryLabel(match, countryCode),
    };
    return {
      suggestion,
      typeRank: typeRank(match.type),
      importance: match.importance ?? 0,
      score: match.score ?? Number.NEGATIVE_INFINITY,
    };
  });

  suggestions.sort((left, right) => {
    if (left.typeRank !== right.typeRank) {
      return left.typeRank - right.typeRank;
    }
    if (right.importance !== left.importance) {
      return right.importance - left.importance;
    }
    return right.score - left.score;
  });

  return suggestions.slice(0, PLACE_SEARCH_RESULT_LIMIT).map((entry) => entry.suggestion);
}
