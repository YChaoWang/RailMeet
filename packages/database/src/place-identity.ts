import { createHash } from 'node:crypto';

import type { PlaceKind } from '@railmeet/shared';

/** Stable RailMeet place id derived from a provider location identity. */
export function placeIdForProviderPlace(provider: string, providerPlaceId: string): string {
  const digest = createHash('sha256').update(`${provider}\0${providerPlaceId}`).digest('hex');
  return `place:${provider}:${digest.slice(0, 40)}`;
}

export function placeKindFromSuggestionType(type: 'ADDRESS' | 'PLACE' | 'STOP'): PlaceKind {
  return type === 'STOP' ? 'station' : 'city';
}
