import {
  asNonEmptyStringTuple,
  isValidCalendarDate,
  isValidLocalTime,
  RANKING_MODES,
  TRANSPORT_MODES,
} from '@railmeet/shared';
import { z } from 'zod';

/**
 * Validation normalization policy:
 * - Trim surrounding whitespace on string inputs that represent IDs, names, labels,
 *   dates, times, and country codes.
 * - Do not silently repair semantically invalid values (e.g. do not coerce `24:00`
 *   to `00:00`, do not drop duplicate modes, do not uppercase country codes for the
 *   caller — lowercase codes are rejected).
 */

export const calendarDateSchema = z.string().trim().refine(isValidCalendarDate, {
  message: 'Must be a valid calendar date in YYYY-MM-DD format',
});

export const localTimeSchema = z.string().trim().refine(isValidLocalTime, {
  message: 'Must be a local time in HH:mm from 00:00 through 23:59',
});

export const isoCountryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}$/, {
    message: 'Must be an uppercase ISO 3166-1 alpha-2 country code',
  });

export const rankingModeSchema = z.enum(asNonEmptyStringTuple(RANKING_MODES));

export const transportModeSchema = z.enum(asNonEmptyStringTuple(TRANSPORT_MODES));

export function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
