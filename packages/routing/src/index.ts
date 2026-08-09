/**
 * Provider-neutral journey planning boundary and Transitous MOTIS 2 adapter.
 *
 * Phase 6: the adapter is ready for Phase 7 candidate destinations.
 * The meeting-search kickoff consumer does not invent destinations or call Transitous.
 */

export type {
  EncodedRouteGeometry,
  GeoCoordinates,
  GeocodePlacesInput,
  GeocodePlacesResult,
  JourneyLeg,
  JourneyLegMode,
  JourneyPlanner,
  PlaceGeocoder,
  PlaceSuggestion,
  PlaceSuggestionType,
  PlanJourneyInput,
  PlanJourneyResult,
  PlannedJourney,
} from './types.js';

export { RoutingError, type RoutingErrorClass, type RoutingErrorCode } from './errors.js';

export {
  MOTIS_OPENAPI_PIN,
  MOTIS_PLAN_API_VERSION,
  assertPlanJourneyCoordinates,
  motisEncodedPolylineSchema,
  normalizeMotisPlanResponse,
} from './motis-normalize.js';

export {
  MOTIS_GEOCODE_API_VERSION,
  MOTIS_GEOCODE_OPENAPI_PIN,
  motisGeocodeResponseSchema,
  normalizeMotisGeocodeResponse,
} from './motis-geocode.js';

export {
  createTransitousJourneyPlanner,
  type TransitousClientOptions,
} from './transitous-client.js';

export { createTransitousPlaceGeocoder } from './transitous-geocode.js';
