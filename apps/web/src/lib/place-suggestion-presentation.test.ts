import { describe, expect, it } from 'vitest';

import {
  placeSuggestionLocalityLine,
  placeSuggestionModeChips,
  placeSuggestionModeOverflowCount,
  placeSuggestionTypeLabel,
} from './place-suggestion-presentation';

describe('placeSuggestionLocalityLine', () => {
  it('strips the type prefix from secondaryLabel', () => {
    expect(
      placeSuggestionLocalityLine({
        providerId: '1',
        name: 'Berlin Hbf',
        type: 'STOP',
        latitude: 0,
        longitude: 0,
        countryCode: 'DE',
        timezone: null,
        modes: [],
        secondaryLabel: 'Station · Berlin, DE',
      }),
    ).toBe('Berlin, DE');
  });

  it('returns the full secondary label when it does not match the type prefix', () => {
    expect(
      placeSuggestionLocalityLine({
        providerId: '1',
        name: 'Somewhere',
        type: 'ADDRESS',
        latitude: 0,
        longitude: 0,
        countryCode: null,
        timezone: null,
        modes: [],
        secondaryLabel: 'Custom context',
      }),
    ).toBe('Custom context');
  });
});

describe('placeSuggestionModeChips', () => {
  it('maps MOTIS modes to labeled chips with stable dedupe', () => {
    const chips = placeSuggestionModeChips(['HIGHSPEED_RAIL', 'SUBWAY', 'HIGHSPEED_RAIL']);
    expect(chips.map((chip) => chip.label)).toEqual(['High-speed rail', 'Metro']);
    expect(chips[0]?.iconKind).toBe('train');
    expect(chips[1]?.iconKind).toBe('metro');
  });

  it('limits visible chips and reports overflow', () => {
    const modes = ['RAIL', 'BUS', 'SUBWAY', 'FERRY', 'TRAM', 'AIRPLANE'];
    expect(placeSuggestionModeChips(modes)).toHaveLength(4);
    expect(placeSuggestionModeOverflowCount(modes)).toBe(2);
  });
});

describe('placeSuggestionTypeLabel', () => {
  it('maps suggestion types to user-facing labels', () => {
    expect(placeSuggestionTypeLabel('STOP')).toBe('Station');
    expect(placeSuggestionTypeLabel('PLACE')).toBe('City');
    expect(placeSuggestionTypeLabel('ADDRESS')).toBe('Address');
  });
});
