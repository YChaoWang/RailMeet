/**
 * Convert a calendar date + local wall-clock time in an IANA zone to a UTC Date.
 * Uses Intl offset iteration (no extra timezone dependency).
 */
export function wallTimeInZoneToUtc(travelDate: string, localTime: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(travelDate)) {
    throw new Error('travelDate must be YYYY-MM-DD');
  }
  const normalizedTime = /^\d{2}:\d{2}$/.test(localTime) ? `${localTime}:00` : localTime;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(normalizedTime)) {
    throw new Error('localTime must be HH:mm or HH:mm:ss');
  }

  const [year, month, day] = travelDate.split('-').map(Number) as [number, number, number];
  const [hour, minute, second] = normalizedTime.split(':').map(Number) as [number, number, number];

  const desiredAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = desiredAsUtcMs;

  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(utcMs));

    const read = (type: Intl.DateTimeFormatPartTypes): number => {
      const value = parts.find((part) => part.type === type)?.value;
      if (!value) {
        throw new Error(`Unable to resolve ${type} in time zone ${timeZone}`);
      }
      return Number(value);
    };

    const asLocalMs = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour'),
      read('minute'),
      read('second'),
    );
    utcMs += desiredAsUtcMs - asLocalMs;
  }

  return new Date(utcMs);
}
