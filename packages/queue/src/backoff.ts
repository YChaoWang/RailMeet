/**
 * Exponential backoff with capped delay and deterministic jitter for tests.
 * Never used to permanently discard valid events.
 */
export function computeRetryDelayMs(options: {
  readonly failureCount: number;
  readonly baseMs: number;
  readonly maxMs: number;
  /** 0..1 — typically derived from event ID for deterministic tests. */
  readonly jitterUnit: number;
}): number {
  const exponent = Math.max(0, options.failureCount);
  const uncapped = options.baseMs * 2 ** exponent;
  const capped = Math.min(options.maxMs, uncapped);
  const jitter = Math.min(1, Math.max(0, options.jitterUnit)) * 0.2 * capped;
  return Math.floor(capped + jitter);
}

export function jitterUnitFromEventId(eventId: string): number {
  let hash = 0;
  for (let i = 0; i < eventId.length; i += 1) {
    hash = (hash * 31 + eventId.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}
