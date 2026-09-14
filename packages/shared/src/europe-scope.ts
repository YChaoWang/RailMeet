/**
 * Supported European geographic scope for RailMeet searches and catalog.
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

/** How many European countries RailMeet can search origins and meeting cities in. */
export const SEARCHABLE_EUROPE_COUNTRY_COUNT = EUROPE_ISO_COUNTRY_CODES.length;

const EUROPE_SET = new Set<string>(EUROPE_ISO_COUNTRY_CODES);

export function isEuropeCountryCode(code: string): boolean {
  return EUROPE_SET.has(code);
}
