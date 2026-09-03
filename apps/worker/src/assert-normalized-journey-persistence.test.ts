import { describe, expect, it } from 'vitest';

import {
  assertIntermediateStopShape,
  assertNormalizedJourneyPersistence,
  assertRankingLegShape,
} from './assert-normalized-journey-persistence.js';

const baseLeg = {
  mode: 'train',
  departureAt: '2026-06-15T08:00:00.000Z',
  arrivalAt: '2026-06-15T10:00:00.000Z',
  durationMinutes: 120,
  motisMode: 'HIGHSPEED_RAIL',
  displayName: 'ICE 100',
};

describe('assertRankingLegShape intermediateStops', () => {
  it('accepts enriched ranking legs with fully populated intermediateStops', () => {
    expect(() =>
      assertRankingLegShape(
        {
          ...baseLeg,
          intermediateStopCount: 1,
          intermediateStops: [
            {
              name: 'Erfurt Hbf',
              latitude: 50.9725,
              longitude: 11.0385,
              arrivalAt: '2026-06-15T09:00:00Z',
              departureAt: '2026-06-15T09:02:00Z',
              scheduledArrivalAt: '2026-06-15T09:00:00Z',
              scheduledDepartureAt: '2026-06-15T09:02:00Z',
              track: '3',
            },
          ],
        },
        'leg',
      ),
    ).not.toThrow();
  });

  it('accepts legacy ranking legs without intermediateStops', () => {
    expect(() => assertRankingLegShape({ ...baseLeg }, 'leg')).not.toThrow();
  });

  it('accepts an empty intermediateStops array', () => {
    expect(() =>
      assertRankingLegShape({ ...baseLeg, intermediateStops: [] }, 'leg'),
    ).not.toThrow();
  });

  it('accepts intermediate stops that omit optional coordinates and times', () => {
    expect(() =>
      assertRankingLegShape(
        {
          ...baseLeg,
          intermediateStops: [{ name: 'Bamberg' }],
        },
        'leg',
      ),
    ).not.toThrow();
  });

  it('rejects unknown ranking-leg root fields', () => {
    expect(() =>
      assertRankingLegShape({ ...baseLeg, tripId: 'trip:1' }, 'leg'),
    ).toThrow(/Unexpected ranking leg field "tripId"/);
  });

  it('rejects intermediateStops that are not an array', () => {
    expect(() =>
      assertRankingLegShape({ ...baseLeg, intermediateStops: { name: 'Erfurt' } }, 'leg'),
    ).toThrow(/intermediateStops must be an array/);
  });

  it('rejects empty or missing intermediate stop names', () => {
    expect(() =>
      assertRankingLegShape({ ...baseLeg, intermediateStops: [{ name: '' }] }, 'leg'),
    ).toThrow(/name must be a non-empty string/);
    expect(() =>
      assertRankingLegShape({ ...baseLeg, intermediateStops: [{ track: '3' }] }, 'leg'),
    ).toThrow(/name must be a non-empty string/);
  });

  it('rejects non-finite latitude or longitude', () => {
    expect(() =>
      assertIntermediateStopShape({ name: 'Erfurt', latitude: Number.NaN }, 'stop'),
    ).toThrow(/latitude must be a finite number/);
    expect(() =>
      assertIntermediateStopShape({ name: 'Erfurt', longitude: Infinity }, 'stop'),
    ).toThrow(/longitude must be a finite number/);
  });

  it('rejects empty optional time or track strings', () => {
    expect(() =>
      assertIntermediateStopShape({ name: 'Erfurt', arrivalAt: '' }, 'stop'),
    ).toThrow(/arrivalAt must be a non-empty string/);
    expect(() =>
      assertIntermediateStopShape({ name: 'Erfurt', track: '' }, 'stop'),
    ).toThrow(/track must be a non-empty string/);
  });

  it('rejects unexpected nested intermediate-stop fields', () => {
    expect(() =>
      assertIntermediateStopShape(
        { name: 'Erfurt', vertexType: 'TRANSIT', lat: 50.9 },
        'stop',
      ),
    ).toThrow(/Unexpected intermediate stop field "vertexType"/);
  });

  it('validates intermediateStops through the full persistence walker', () => {
    expect(() =>
      assertNormalizedJourneyPersistence([
        {
          ...baseLeg,
          intermediateStops: [
            {
              name: 'Erfurt Hbf',
              latitude: 50.9725,
              longitude: 11.0385,
              track: '3',
            },
          ],
        },
      ]),
    ).not.toThrow();

    expect(() =>
      assertNormalizedJourneyPersistence([
        {
          ...baseLeg,
          intermediateStops: [{ name: 'Erfurt', tripId: 'provider-only' }],
        },
      ]),
    ).toThrow(/Unexpected intermediate stop field "tripId"/);
  });
});
