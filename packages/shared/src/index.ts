export const RAILMEET_NAME = 'RailMeet' as const;

export {
  ALLOWED_COUNTRY_CODES_MAX,
  ALLOWED_TRANSPORT_MODES_MAX,
  ARRIVAL_DAY_OFFSET_MAX,
  ARRIVAL_DAY_OFFSET_MIN,
  ARRIVAL_DAY_OFFSET_NEXT_DAY,
  ARRIVAL_DAY_OFFSET_SAME_DAY,
  MAX_JOURNEY_DURATION_MINUTES_UPPER_BOUND,
  MAX_TRANSFERS_UPPER_BOUND,
  MIN_TRANSFER_DURATION_MINUTES_UPPER_BOUND,
  PARTICIPANT_COUNT_MAX,
  PARTICIPANT_COUNT_MIN,
  PARTICIPANT_ID_MAX_LENGTH,
  PARTICIPANT_NAME_MAX_LENGTH,
  IANA_TIMEZONE_MAX_LENGTH,
  PLACE_ID_MAX_LENGTH,
  PLACE_LABEL_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
} from './limits.js';

export { asNonEmptyStringTuple } from './tuple.js';

export { RANKING_MODES, isRankingMode, type RankingMode } from './ranking-mode.js';
export { TRANSPORT_MODES, isTransportMode, type TransportMode } from './transport-mode.js';
export { SEARCH_STATUSES, isSearchStatus, type SearchStatus } from './search-status.js';
export { API_ERROR_CODES, isApiErrorCode, type ApiErrorCode } from './api-error-codes.js';
export { PLACE_KINDS, isPlaceKind, type PlaceKind } from './place-kind.js';

export { isValidCalendarDate, isValidLocalTime } from './calendar.js';

export type { PlaceReference } from './place.js';
export type { Participant } from './participant.js';
export type { SearchConstraints } from './search-constraints.js';
export type { SearchRequest } from './search-request.js';

export { err, ok, type Result } from './result.js';
