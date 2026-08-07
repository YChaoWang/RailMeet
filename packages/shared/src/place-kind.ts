/**
 * Stable place kinds for canonical RailMeet places.
 * Minimal set for meeting-search origins and candidate cities.
 * GTFS/MOTIS location types are intentionally not mirrored here.
 */
export const PLACE_KINDS = ['city', 'station'] as const;

export type PlaceKind = (typeof PLACE_KINDS)[number];

export function isPlaceKind(value: string): value is PlaceKind {
  return (PLACE_KINDS as readonly string[]).includes(value);
}
