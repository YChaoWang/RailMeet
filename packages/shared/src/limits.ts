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
