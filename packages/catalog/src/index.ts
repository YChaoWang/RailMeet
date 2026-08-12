export { validateCatalogArtifact, parseCatalogArtifact, haversineMeters } from './validate.js';
export { importCatalogArtifact, loadCatalogArtifactFile } from './import.js';
export {
  evaluateCatalogReadiness,
  classifyProductionReadiness,
  buildCatalogStatusReport,
  type CatalogStatusCounts,
  type CatalogStatusReport,
} from './readiness.js';
export {
  selectRoutingTarget,
  type HubCandidate,
  type RoutingTargetSelection,
} from './hub-select.js';
export { associateCityToHub } from './associate.js';
export {
  parseGeonamesLine,
  parseGeonamesCitiesFile,
  buildGeonamesCitiesArtifact,
  looksLikeLatLonReversed,
} from './geonames-parse.js';
export {
  downloadGeonamesCities15000,
  verifyGeonamesChecksum,
  GEONAMES_CITIES15000_URL,
  GEONAMES_SOURCE_DEFAULTS,
} from './geonames-download.js';
export { EUROPE_ISO_COUNTRY_CODES, CITY_SELECTION_POLICY_VERSION } from './europe-scope.js';
export {
  MEETING_CITY_POLICY_VERSION,
  MEETING_CITY_MIN_POPULATION,
  MEETING_CITY_ADMIN_FEATURE_CODES,
  isMeetingCityTierEligible,
  isProductionMeetingCityCandidate,
  classifyMeetingCityTier,
} from './eligibility.js';
export {
  classifyHubCapability,
  isEligiblePrimaryHubCapability,
  type HubCapabilityClass,
} from './associate.js';
export { defaultFixturePath, loadCatalogStatus } from './cli-lib.js';
export type {
  CatalogArtifact,
  CatalogCity,
  CatalogHub,
  CatalogReadiness,
  CatalogValidationReport,
  ProductionReadinessKind,
  SourceManifest,
} from './types.js';
