/**
 * Supported European geographic scope for RailMeet meeting-city catalog.
 * ISO 3166-1 alpha-2. Explicit list — not inferred from fixture presence.
 *
 * Includes EU/EEA members, UK, Switzerland, and commonly connected European
 * rail markets used by Transitous coverage. Excludes overseas territories.
 */
export const EUROPE_ISO_COUNTRY_CODES = [
  'AD',
  'AL',
  'AT',
  'BA',
  'BE',
  'BG',
  'BY',
  'CH',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GB',
  'GR',
  'HR',
  'HU',
  'IE',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MD',
  'ME',
  'MK',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'RS',
  'SE',
  'SI',
  'SK',
  'SM',
  'UA',
  'VA',
  'XK',
] as const;

export type EuropeIsoCountryCode = (typeof EUROPE_ISO_COUNTRY_CODES)[number];

const EUROPE_SET = new Set<string>(EUROPE_ISO_COUNTRY_CODES);

export function isEuropeCountryCode(code: string): boolean {
  return EUROPE_SET.has(code);
}

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
