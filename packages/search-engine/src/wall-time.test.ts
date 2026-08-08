import { describe, expect, it } from 'vitest';

import { wallTimeInZoneToUtc } from './wall-time.js';

describe('wallTimeInZoneToUtc', () => {
  it('converts Berlin local wall time to UTC', () => {
    const utc = wallTimeInZoneToUtc('2026-06-15', '08:00', 'Europe/Berlin');
    expect(utc.toISOString()).toBe('2026-06-15T06:00:00.000Z');
  });
});
