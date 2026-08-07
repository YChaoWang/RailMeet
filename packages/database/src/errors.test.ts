import { describe, expect, it } from 'vitest';

import { isDatabaseUnavailableError, isUniqueViolationError } from './errors.js';

describe('driver error classification', () => {
  it('detects PostgreSQL unique violations', () => {
    expect(isUniqueViolationError({ code: '23505' })).toBe(true);
    expect(isUniqueViolationError({ code: '23503' })).toBe(false);
  });

  it('detects unavailable connection codes', () => {
    expect(isDatabaseUnavailableError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isDatabaseUnavailableError({ code: '57P03' })).toBe(true);
    expect(isDatabaseUnavailableError({ code: '23505' })).toBe(false);
  });
});
