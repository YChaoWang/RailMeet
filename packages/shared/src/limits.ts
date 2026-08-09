/**
 * Named limits for meeting-search inputs.
 * Keep these as the single source of truth for schemas and tests.
 */

/** Minimum number of participants in one meeting search. */
export const PARTICIPANT_COUNT_MIN = 2;

/** Maximum number of participants in one meeting search. */
export const PARTICIPANT_COUNT_MAX = 6;

/** Maximum length of a participant ID after trimming. */
export const PARTICIPANT_ID_MAX_LENGTH = 64;

/** Maximum length of a participant display name after trimming. */
export const PARTICIPANT_NAME_MAX_LENGTH = 80;

/** Maximum length of a canonical RailMeet place ID after trimming. */
export const PLACE_ID_MAX_LENGTH = 128;

/** Maximum length of a canonical place display name. */
export const PLACE_NAME_MAX_LENGTH = 200;

/** Maximum length of an optional client-supplied place label after trimming. */
export const PLACE_LABEL_MAX_LENGTH = 120;

/** Minimum non-whitespace characters before place autocomplete queries run. */
export const PLACE_SEARCH_QUERY_MIN_LENGTH = 2;

/** Maximum place autocomplete query length after trimming. */
export const PLACE_SEARCH_QUERY_MAX_LENGTH = 100;

/** Maximum normalized suggestions returned to clients. */
export const PLACE_SEARCH_RESULT_LIMIT = 8;

/** Maximum length of a provider place identity (e.g. MOTIS Match.id). */
export const PROVIDER_PLACE_ID_MAX_LENGTH = 512;

/** Short-lived geocode cache TTL for identical normalized queries. */
export const PLACE_GEOCODE_CACHE_TTL_MS = 30_000;

/** Viewport map-stops cache TTL (identical quantized bounds + zoom). */
export const MAP_STOPS_CACHE_TTL_MS = 10 * 60 * 1000;

/** Upper bound on in-memory map-stops cache entries (LRU eviction). */
export const MAP_STOPS_CACHE_MAX_ENTRIES = 200;

/** Decimal places used when quantizing viewport bounds for cache keys. */
export const MAP_STOPS_BOUNDS_QUANTIZE_DECIMALS = 3;

/** Soft limit on station features returned for a viewport.
 * Larger responses are truncated to major/regional stops.
 */
export const MAP_STOPS_FEATURE_SOFT_LIMIT = 1500;

/** Provider HTTP body size cap for viewport map-stops (dense cities exceed plan payloads). */
export const MAP_STOPS_MAX_RESPONSE_BYTES = 8 * 1_048_576;

/** Zoom at which detailed (local) stops are expected. */
export const MAP_STOPS_DETAILED_ZOOM_MIN = 12;

/**
 * Max lat/lon span (degrees) for a map-stops request at any zoom.
 * Transitous MOTIS `/map/stops` returns HTTP 422 for boxes around ≥0.5°.
 */
export const MAP_STOPS_MAX_REQUEST_SPAN_DEG = 0.4;

/** @deprecated Prefer MAP_STOPS_MAX_REQUEST_SPAN_DEG — same limit applies at all zooms. */
export const MAP_STOPS_DETAILED_MAX_SPAN_DEG = MAP_STOPS_MAX_REQUEST_SPAN_DEG;

/** Suggested minimum zoom when the API returns an aggregated/truncated subset. */
export const MAP_STOPS_MINIMUM_DETAIL_ZOOM = 12;

/** Importance thresholds for MOTIS Place.importance → major/regional/local. */
export const MAP_STOPS_IMPORTANCE_MAJOR_MIN = 0.04;
export const MAP_STOPS_IMPORTANCE_REGIONAL_MIN = 0.01;

/** Upper bound for a single encoded polyline `points` string from MOTIS. */
export const ENCODED_POLYLINE_POINTS_MAX_LENGTH = 200_000;

/** Inclusive bounds for MOTIS EncodedPolyline precision (v5 typically 6). */
export const ENCODED_POLYLINE_PRECISION_MIN = 1;
export const ENCODED_POLYLINE_PRECISION_MAX = 10;

/** Maximum length of an IANA timezone identifier. */
export const IANA_TIMEZONE_MAX_LENGTH = 64;

/**
 * Upper bound on transfers per journey.
 * High enough for realistic European itineraries; low enough to prune nonsense.
 */
export const MAX_TRANSFERS_UPPER_BOUND = 5;

/**
 * Upper bound on journey duration in minutes (24 hours).
 * Longer journeys are out of scope for a same-/next-day meet-up.
 */
export const MAX_JOURNEY_DURATION_MINUTES_UPPER_BOUND = 24 * 60;

/**
 * Upper bound on minimum transfer duration in minutes (2 hours).
 * Captures conservative connection buffers without accepting unbounded values.
 */
export const MIN_TRANSFER_DURATION_MINUTES_UPPER_BOUND = 120;

/** Same-day arrival relative to `travelDate`. */
export const ARRIVAL_DAY_OFFSET_SAME_DAY = 0;

/** Next-day arrival relative to `travelDate` (overnight journeys). */
export const ARRIVAL_DAY_OFFSET_NEXT_DAY = 1;

/** Inclusive lower bound for arrival-day offset. */
export const ARRIVAL_DAY_OFFSET_MIN = ARRIVAL_DAY_OFFSET_SAME_DAY;

/** Inclusive upper bound for arrival-day offset. */
export const ARRIVAL_DAY_OFFSET_MAX = ARRIVAL_DAY_OFFSET_NEXT_DAY;

/** Maximum number of allowed transport modes in one request (all known modes). */
export const ALLOWED_TRANSPORT_MODES_MAX = 8;

/** Maximum number of country filter codes in one request. */
export const ALLOWED_COUNTRY_CODES_MAX = 50;
