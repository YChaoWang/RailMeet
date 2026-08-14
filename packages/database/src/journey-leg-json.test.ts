import { MOTIS_PLAN_ITINERARY_FORMAT } from '@railmeet/shared';
import { describe, expect, it } from 'vitest';

import { parseStoredJourneyLegs, storedJourneyLegsJson } from './journey-leg-json.js';
import { STORED_JOURNEY_LEGS_FORMAT } from './schema/tables.js';

const rankingLeg = {
  mode: 'train',
  departureAt: '2026-09-15T08:23:00.000Z',
  arrivalAt: '2026-09-15T09:22:00.000Z',
  durationMinutes: 59,
  displayName: 'TPE',
  agencyName: 'TransPennine Express',
};

const itinerary = {
  duration: 3600,
  startTime: '2026-09-15T08:23:00Z',
  endTime: '2026-09-15T09:22:00Z',
  transfers: 0,
  id: 'itinerary:fixture:manchester-york:v1',
  legs: [
    {
      mode: 'REGIONAL_RAIL',
      displayName: 'TPE',
      agencyName: 'TransPennine Express',
      startTime: '2026-09-15T08:23:00Z',
      endTime: '2026-09-15T09:22:00Z',
      duration: 3540,
      alerts: [{ headerText: 'Special Service' }],
      intermediateStops: [{ name: 'Huddersfield', track: '4' }],
    },
  ],
};

describe('stored journey legs JSON', () => {
  it('reads legacy ranking-leg arrays without a provider itinerary', () => {
    const parsed = parseStoredJourneyLegs([rankingLeg]);
    expect(parsed.rankingLegs).toEqual([rankingLeg]);
    expect(parsed.providerItinerary).toBeNull();
    expect(parsed.storageKind).toBe('legacy_array');
    expect(parsed.unavailableReason).toBeNull();
  });

  it('round-trips a versioned MOTIS itinerary beside ranking legs', () => {
    const stored = storedJourneyLegsJson({
      rankingLegs: [rankingLeg],
      providerItinerary: {
        format: MOTIS_PLAN_ITINERARY_FORMAT,
        motisPlanApiVersion: 'v5',
        motisOpenApiPin: 'motis@2.10.2:/api/v5/plan',
        itinerary,
      },
    });
    expect(stored).toMatchObject({
      format: STORED_JOURNEY_LEGS_FORMAT,
      motisPlanApiVersion: 'v5',
    });
    const parsed = parseStoredJourneyLegs(stored);
    expect(parsed.storageKind).toBe('provider_document');
    expect(parsed.rankingLegs).toEqual([rankingLeg]);
    expect(parsed.providerItinerary?.itinerary.id).toBe(
      'itinerary:fixture:manchester-york:v1',
    );
    expect(parsed.providerItinerary?.itinerary.legs[0]?.alerts?.[0]?.headerText).toBe(
      'Special Service',
    );
    expect(parsed.providerItinerary?.itinerary.legs[0]?.intermediateStops?.[0]?.track).toBe('4');
  });

  it('handles corrupt provider documents without inventing itineraries', () => {
    const corrupt = {
      format: STORED_JOURNEY_LEGS_FORMAT,
      motisPlanApiVersion: 'v5',
      motisOpenApiPin: 'motis@2.10.2:/api/v5/plan',
      rankingLegs: [rankingLeg],
      itinerary: { not: 'usable' },
    };
    const parsed = parseStoredJourneyLegs(corrupt);
    expect(parsed.storageKind).toBe('provider_document');
    expect(parsed.providerItinerary).toBeNull();
    expect(parsed.unavailableReason).toBe('provider_itinerary_invalid');
    expect(parsed.rankingLegs).toEqual([rankingLeg]);
  });

  it('marks unrecognized payloads safely', () => {
    const parsed = parseStoredJourneyLegs({ weird: true });
    expect(parsed.storageKind).toBe('unrecognized');
    expect(parsed.rankingLegs).toEqual([]);
    expect(parsed.unavailableReason).toBe('unrecognized_legs_document');
  });
});
