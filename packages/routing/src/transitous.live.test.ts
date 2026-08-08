import { describe, expect, it } from 'vitest';

import { createTransitousJourneyPlanner } from './transitous-client.js';

/**
 * Opt-in live smoke against the public Transitous MOTIS 2 API.
 * Not part of ordinary unit tests. Exactly one plan request.
 */
describe('Transitous live smoke', () => {
  it('returns at least one structurally valid journey', async () => {
    const baseUrl = process.env.TRANSITOUS_BASE_URL ?? 'https://api.transitous.org/api';
    const userAgent =
      process.env.TRANSITOUS_USER_AGENT ?? 'RailMeet/0.0.0 (+https://github.com/example/railmeet)';

    const planner = createTransitousJourneyPlanner({
      baseUrl,
      userAgent,
      timeoutMs: 20_000,
      maxResponseBytes: 1_048_576,
    });

    // Stable European city-center coordinates; future travel date for timetable coverage.
    const result = await planner.planJourney({
      origin: { latitude: 52.520008, longitude: 13.404954 },
      destination: { latitude: 48.137154, longitude: 11.576124 },
      departureAt: new Date('2026-09-15T08:00:00.000Z'),
      maxTransfers: 3,
    });

    expect(result.journeys.length).toBeGreaterThanOrEqual(1);
    const journey = result.journeys[0]!;
    expect(journey.departureAt).toBeInstanceOf(Date);
    expect(journey.arrivalAt).toBeInstanceOf(Date);
    expect(journey.arrivalAt.getTime()).toBeGreaterThanOrEqual(journey.departureAt.getTime());
    expect(journey.durationMinutes).toBeGreaterThan(0);
    expect(journey.transfers).toBeGreaterThanOrEqual(0);
    expect(journey.legs.length).toBeGreaterThan(0);
  }, 25_000);
});
