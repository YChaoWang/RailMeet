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
  MIN_PARTICIPANTS,
  MAX_PARTICIPANTS,
  SEARCH_LIMITS,
  ROUTING_PLAN_CACHE_TTL_MS,
  PARTICIPANT_ID_MAX_LENGTH,
  PARTICIPANT_NAME_MAX_LENGTH,
  IANA_TIMEZONE_MAX_LENGTH,
  PLACE_ID_MAX_LENGTH,
  PLACE_LABEL_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
  PLACE_SEARCH_QUERY_MIN_LENGTH,
  PLACE_SEARCH_QUERY_MAX_LENGTH,
  PLACE_SEARCH_RESULT_LIMIT,
  PROVIDER_PLACE_ID_MAX_LENGTH,
  PLACE_GEOCODE_CACHE_TTL_MS,
  MAP_STOPS_CACHE_TTL_MS,
  MAP_STOPS_CACHE_MAX_ENTRIES,
  MAP_STOPS_BOUNDS_QUANTIZE_DECIMALS,
  MAP_STOPS_FEATURE_SOFT_LIMIT,
  MAP_STOPS_MAX_RESPONSE_BYTES,
  MAP_STOPS_DETAILED_ZOOM_MIN,
  MAP_STOPS_MAX_REQUEST_SPAN_DEG,
  MAP_STOPS_DETAILED_MAX_SPAN_DEG,
  MAP_STOPS_MINIMUM_DETAIL_ZOOM,
  MAP_STOPS_IMPORTANCE_MAJOR_MIN,
  MAP_STOPS_IMPORTANCE_REGIONAL_MIN,
  ARRIVAL_TOLERANCE_MINUTES,
  ARRIVAL_TOLERANCE_MS,
  ENCODED_POLYLINE_POINTS_MAX_LENGTH,
  ENCODED_POLYLINE_PRECISION_MIN,
  ENCODED_POLYLINE_PRECISION_MAX,
  /** Minimum active meeting cities required before routing is scheduled. */
  CATALOG_MIN_ACTIVE_CITIES,
  /** Soft max city→hub distance for ordinary stations (meters). */
  CATALOG_HUB_DISTANCE_SOFT_MAX_METERS,
  /** Absolute max city→hub distance unless marked regional (meters). */
  CATALOG_HUB_DISTANCE_HARD_MAX_METERS,
  /** Max representative hubs attempted per candidate city. */
  CATALOG_MAX_HUBS_PER_CANDIDATE,
} from './limits.js';

export { asNonEmptyStringTuple } from './tuple.js';

export { RANKING_MODES, isRankingMode, type RankingMode } from './ranking-mode.js';
export { TRANSPORT_MODES, isTransportMode, type TransportMode } from './transport-mode.js';
export {
  MOTIS_PLAN_MODES,
  MOTIS_PLAN_MODE_LABELS,
  MOTIS_PLAN_OPENAPI_PIN,
  UNKNOWN_MOTIS_MODE_LABEL,
  canonicalMotisModeToken,
  formatJourneyOperatorLabel,
  formatJourneyServiceLabel,
  isMotisPlanMode,
  mapMotisPlanModeToDomain,
  motisPlanModeLabel,
  parseMotisPlanMode,
  type JourneyLegMode,
  type JourneyServiceIdentity,
  type MotisPlanMode,
} from './motis-plan-mode.js';
export {
  MOTIS_PLAN_ITINERARY_FORMAT,
  isMotisTransitLeg,
  isMotisWalkLeg,
  joinInterlinedMotisLegs,
  motisDirectionLabel,
  motisLegAgencyName,
  motisLegDisplayName,
  motisPlaceName,
  motisPlaceTrack,
  type MotisAlertJson,
  type MotisItineraryJson,
  type MotisLegJson,
  type MotisPlaceJson,
  type MotisPlanItineraryPayload,
  type MotisStepJson,
} from './motis-itinerary.js';
export {
  contrastTextForBackground,
  getMotisModeStyle,
  getMotisRouteColors,
  resolveMapRoutePaint,
  sanitizeMotisHexColor,
  type MotisColorable,
  type MotisModeIconKind,
  type MotisRoutePaint,
} from './motis-mode-style.js';
export {
  ROUTE_SUMMARY_DISPLAY_NAME_MAX,
  ROUTE_SUMMARY_SEGMENTS_MAX,
  buildRouteSummary,
  buildRouteSummaryFromProviderItinerary,
  buildRouteSummaryFromRankingLegs,
  type RankingLegForRouteSummary,
  type RouteSummarySegment,
} from './route-summary.js';
export {
  pickJourneyLegIdentity,
  type JourneyLegIdentityFields,
  type JourneyLegIntermediateStop,
  type JourneyLegStopView,
} from './journey-leg-identity.js';
export { SEARCH_STATUSES, isSearchStatus, type SearchStatus } from './search-status.js';
export {
  TERMINAL_SEARCH_STATUSES,
  POLLING_SEARCH_STATUSES,
  isTerminalSearchStatus,
  shouldContinueSearchPolling,
  shouldFetchSearchResults,
  assertSearchStatusLifecycleCoverage,
  type TerminalSearchStatus,
  type PollingSearchStatus,
} from './search-lifecycle.js';
export {
  SEARCH_COMPLETION_OUTCOMES,
  SEARCH_FAILURE_CODES,
  isSearchCompletionOutcome,
  isSearchFailureCode,
  type SearchCompletionOutcome,
  type SearchFailureCode,
} from './search-completion.js';
export { API_ERROR_CODES, isApiErrorCode, type ApiErrorCode } from './api-error-codes.js';
export { PLACE_KINDS, isPlaceKind, type PlaceKind } from './place-kind.js';
export {
  PLACE_OWNERSHIPS,
  CATALOG_MANAGED_OWNERSHIPS,
  PRODUCTION_CITY_OWNERSHIPS,
  PRODUCTION_HUB_OWNERSHIPS,
  isPlaceOwnership,
  isCatalogManagedOwnership,
  isProductionCityOwnership,
  isFixtureCityOwnership,
  type PlaceOwnership,
  type CatalogManagedOwnership,
} from './place-ownership.js';

export { isValidCalendarDate, isValidLocalTime } from './calendar.js';

export type { PlaceReference } from './place.js';
export type { Participant } from './participant.js';
export type { SearchConstraints } from './search-constraints.js';
export type { SearchRequest } from './search-request.js';

export { err, ok, type Result } from './result.js';

export { buildReleaseIdentity, type ReleaseIdentity } from './release-identity.js';
