/**
 * Provider-neutral journey planning boundary and Transitous MOTIS 2 adapter.
 *
 * Phase 6: the adapter is ready for Phase 7 candidate destinations.
 * The meeting-search kickoff consumer does not invent destinations or call Transitous.
 */

export type {
  GeoCoordinates,
  JourneyLeg,
  JourneyLegMode,
  JourneyPlanner,
  PlanJourneyInput,
  PlanJourneyResult,
  PlannedJourney,
} from './types.js';

export { RoutingError, type RoutingErrorClass, type RoutingErrorCode } from './errors.js';

export {
  MOTIS_OPENAPI_PIN,
  MOTIS_PLAN_API_VERSION,
  assertPlanJourneyCoordinates,
  normalizeMotisPlanResponse,
} from './motis-normalize.js';

export {
  createTransitousJourneyPlanner,
  type TransitousClientOptions,
} from './transitous-client.js';
