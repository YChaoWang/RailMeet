/**
 * Provider-neutral reference to a canonical RailMeet place.
 *
 * Distinctions:
 * - `placeId`: stable canonical RailMeet identifier (primary domain key).
 * - `label`: optional human-readable display hint from the client.
 *   Labels are not authoritative; canonical names come from the location source.
 * - Provider-specific IDs (Transitous, GTFS, MOTIS, …) must stay inside routing adapters.
 *
 * Place ID contract:
 * - Opaque non-empty string after trimming (max length: `PLACE_ID_MAX_LENGTH`).
 * - Not a UUID requirement — PostgreSQL stores the same text primary key.
 * - Recommended namespace form for new IDs: `place:<slug>` (e.g. `place:berlin-hbf`).
 * - Existence is validated against the places table in persistence, not by Zod alone.
 *
 * Client-supplied coordinates are intentionally omitted: they are not trusted as
 * authoritative routing geometry. Coordinates and timezones are loaded later from
 * the location source or database.
 */
export type PlaceReference = {
  readonly placeId: string;
  readonly label?: string;
};
