/**
 * Provider-independent public-transport modes used by RailMeet.
 *
 * These values are domain vocabulary, not Transitous/MOTIS/GTFS identifiers.
 * Provider-specific mappings belong in a future `@railmeet/routing` adapter.
 */
export const TRANSPORT_MODES = ['train', 'bus', 'tram', 'metro', 'ferry'] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];

export function isTransportMode(value: string): value is TransportMode {
  return (TRANSPORT_MODES as readonly string[]).includes(value);
}
