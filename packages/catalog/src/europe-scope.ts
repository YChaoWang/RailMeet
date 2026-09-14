export {
  EUROPE_ISO_COUNTRY_CODES,
  isEuropeCountryCode,
  type EuropeIsoCountryCode,
} from '@railmeet/shared';

/** Selection policy version recorded on production city artifacts. */
export const CITY_SELECTION_POLICY_VERSION = 'geonames-europe-ppl-v1';

/**
 * GeoNames feature codes eligible as meeting cities within cities15000.
 * cities15000 already filters population > 15000 or capitals; we further
 * require feature class P (populated place) and these codes.
 */
export const GEONAMES_ELIGIBLE_FEATURE_CODES = [
  'PPL',
  'PPLA',
  'PPLA2',
  'PPLA3',
  'PPLA4',
  'PPLC',
  'PPLG',
  'PPLS',
] as const;
