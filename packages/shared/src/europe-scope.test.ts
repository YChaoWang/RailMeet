import { describe, expect, it } from 'vitest';

import {
  EUROPE_ISO_COUNTRY_CODES,
  SEARCHABLE_EUROPE_COUNTRY_COUNT,
  isEuropeCountryCode,
} from './europe-scope.js';

describe('European search coverage', () => {
  it('counts each ISO country code once', () => {
    expect(SEARCHABLE_EUROPE_COUNTRY_COUNT).toBe(EUROPE_ISO_COUNTRY_CODES.length);
    expect(new Set(EUROPE_ISO_COUNTRY_CODES).size).toBe(SEARCHABLE_EUROPE_COUNTRY_COUNT);
    expect(SEARCHABLE_EUROPE_COUNTRY_COUNT).toBeGreaterThanOrEqual(40);
    expect(isEuropeCountryCode('DE')).toBe(true);
    expect(isEuropeCountryCode('US')).toBe(false);
  });
});
