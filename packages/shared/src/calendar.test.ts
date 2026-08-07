import { describe, expect, it } from 'vitest';

import { isValidCalendarDate, isValidLocalTime } from './calendar.js';

describe('isValidCalendarDate', () => {
  it('accepts a valid leap-day date', () => {
    expect(isValidCalendarDate('2024-02-29')).toBe(true);
  });

  it('rejects an impossible calendar date', () => {
    expect(isValidCalendarDate('2026-02-31')).toBe(false);
  });

  it('rejects a non-leap-year February 29', () => {
    expect(isValidCalendarDate('2026-02-29')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isValidCalendarDate('2026/03/15')).toBe(false);
    expect(isValidCalendarDate('26-03-15')).toBe(false);
  });
});

describe('isValidLocalTime', () => {
  it('accepts boundary times', () => {
    expect(isValidLocalTime('00:00')).toBe(true);
    expect(isValidLocalTime('23:59')).toBe(true);
  });

  it('rejects invalid times', () => {
    expect(isValidLocalTime('24:00')).toBe(false);
    expect(isValidLocalTime('12:60')).toBe(false);
    expect(isValidLocalTime('9:00')).toBe(false);
  });
});
