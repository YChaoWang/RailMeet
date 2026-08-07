const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Returns true when `value` is a real Gregorian calendar date in `YYYY-MM-DD`.
 * Rejects impossible dates such as `2026-02-31`. Does not compare against "today".
 */
export function isValidCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  // Use UTC construction so the check is timezone-independent.
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

/**
 * Returns true when `value` is a 24-hour local time `HH:mm` from `00:00` to `23:59`.
 * Requires zero-padded hours and minutes. Rejects `24:00`, `12:60`, and `9:00`.
 */
export function isValidLocalTime(value: string): boolean {
  return LOCAL_TIME_PATTERN.test(value);
}
