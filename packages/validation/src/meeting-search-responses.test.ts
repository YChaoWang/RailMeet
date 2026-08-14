import type { MotisLegJson } from '@railmeet/shared';
import { describe, expect, it } from 'vitest';

import {
  meetingSearchJourneyDetailDataSchema,
  meetingSearchResultsDataSchema,
  meetingSearchSelectedJourneyViewSchema,
} from './meeting-search-responses.js';

const compactJourney = {
  journeyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  participantId: 'p1',
  participantDisplayName: 'Alex',
  participantPosition: 0,
  origin: { placeId: 'place:manchester' },
  destination: { placeId: 'place:york' },
  departureAt: '2026-09-15T08:15:00.000Z',
  arrivalAt: '2026-09-15T09:58:00.000Z',
  durationMinutes: 103,
  transfers: 2,
  transportModes: ['tram', 'train'],
  routeSummary: [
    { mode: 'TRAM', displayName: 'Yellow Line', routeColor: '#efbb00' },
    { mode: 'REGIONAL_RAIL', displayName: 'TPE', routeColor: '#09a4ec' },
  ],
  legs: [
    {
      mode: 'train',
      departureAt: '2026-09-15T08:23:00.000Z',
      arrivalAt: '2026-09-15T09:22:00.000Z',
      durationMinutes: 59,
      geometry: null,
      displayName: 'TPE',
    },
  ],
};

describe('compact meetingSearchSelectedJourneyViewSchema', () => {
  it('requires journeyId and routeSummary and strips providerItinerary from output', () => {
    const parsed = meetingSearchSelectedJourneyViewSchema.parse({
      ...compactJourney,
      providerItinerary: { kept: false },
      itineraryId: 'should-strip',
    });
    expect(parsed.journeyId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(parsed.routeSummary[0]?.displayName).toBe('Yellow Line');
    expect(parsed).not.toHaveProperty('providerItinerary');
    expect(parsed).not.toHaveProperty('itineraryId');
  });

  it('rejects invalid routeSummary colors', () => {
    expect(
      meetingSearchSelectedJourneyViewSchema.safeParse({
        ...compactJourney,
        routeSummary: [{ mode: 'RAIL', routeColor: '09a4ec' }],
      }).success,
    ).toBe(false);
  });
});

describe('meetingSearchResultsDataSchema', () => {
  it('accepts compact rankings without provider itineraries', () => {
    const parsed = meetingSearchResultsDataSchema.parse({
      searchId: '44444444-4444-4444-8444-444444444444',
      status: 'completed',
      completionOutcome: 'ranked',
      rankingMode: 'fairest',
      recommendedDestination: { placeId: 'place:york' },
      rankings: [
        {
          rankingMode: 'fairest',
          rank: 1,
          destination: { placeId: 'place:york' },
          recommended: true,
          totalDurationMinutes: 103,
          maxDurationMinutes: 103,
          durationRangeMinutes: 0,
          totalTransfers: 2,
          maxTransfers: 2,
          earliestArrivalAt: '2026-09-15T09:58:00.000Z',
          latestArrivalAt: '2026-09-15T09:58:00.000Z',
          arrivalSpreadMs: 0,
          journeys: [compactJourney],
        },
      ],
    });
    expect(parsed.rankings[0]?.journeys[0]?.journeyId).toBe(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(JSON.stringify(parsed)).not.toContain('providerItinerary');
  });
});

describe('meetingSearchJourneyDetailDataSchema', () => {
  it('keeps nested MOTIS itinerary fields for provider detailSource', () => {
    const parsed = meetingSearchJourneyDetailDataSchema.parse({
      journeyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      detailSource: 'provider',
      itineraryId: 'itinerary:fixture:manchester-york:v1',
      providerItinerary: {
        format: 'motis-plan-itinerary-v1',
        motisPlanApiVersion: 'v5',
        motisOpenApiPin: 'motis@2.10.2:/api/v5/plan',
        itinerary: {
          duration: 6180,
          startTime: '2026-09-15T08:15:00Z',
          endTime: '2026-09-15T09:58:00Z',
          transfers: 2,
          id: 'itinerary:fixture:manchester-york:v1',
          fareTransfers: [{ fare: 'kept' }],
          legs: [
            {
              mode: 'REGIONAL_RAIL',
              startTime: '2026-09-15T08:23:00Z',
              endTime: '2026-09-15T09:22:00Z',
              duration: 3540,
              displayName: 'TPE',
              agencyName: 'TransPennine Express',
              headsign: 'Hull',
              tripTo: { name: 'Hull', track: '5' },
              routeColor: '09a4ec',
              routeTextColor: 'ffffff',
              intermediateStops: [{ name: 'Huddersfield', track: '4', tz: 'Europe/London' }],
              alerts: [{ headerText: 'Special Service', descriptionText: 'Altered calling' }],
              alternatives: [
                [
                  {
                    mode: 'REGIONAL_RAIL',
                    displayName: 'Northern',
                    startTime: '2026-09-15T08:40:00Z',
                    endTime: '2026-09-15T09:40:00Z',
                    duration: 3600,
                  },
                ],
              ],
              steps: [{ streetName: 'Station Approach', distance: 20 }],
              legGeometry: { points: 'abc', precision: 6, length: 3 },
              interlineWithPreviousLeg: false,
              reservation: 'NONE',
              bikesAllowed: true,
              wheelchairAccessible: 'ACCESSIBLE',
              realTime: true,
              cancelled: false,
            },
          ],
        },
      },
      legs: compactJourney.legs,
      providerItineraryUnavailableReason: null,
    });

    const leg = parsed.providerItinerary?.itinerary.legs[0] as MotisLegJson;
    expect(parsed.detailSource).toBe('provider');
    expect(parsed.itineraryId).toBe('itinerary:fixture:manchester-york:v1');
    expect(leg).toMatchObject({
      displayName: 'TPE',
      agencyName: 'TransPennine Express',
      headsign: 'Hull',
      routeColor: '09a4ec',
      reservation: 'NONE',
      bikesAllowed: true,
      wheelchairAccessible: 'ACCESSIBLE',
    });
    expect(leg?.tripTo).toEqual({ name: 'Hull', track: '5' });
    expect(leg?.intermediateStops).toEqual([
      { name: 'Huddersfield', track: '4', tz: 'Europe/London' },
    ]);
    expect(leg?.alerts).toEqual([
      { headerText: 'Special Service', descriptionText: 'Altered calling' },
    ]);
    expect(leg?.alternatives?.[0]?.[0]?.displayName).toBe('Northern');
    expect(leg?.steps?.[0]?.streetName).toBe('Station Approach');
    expect(leg?.legGeometry).toEqual({ points: 'abc', precision: 6, length: 3 });
    expect(parsed.providerItinerary?.itinerary.fareTransfers).toEqual([{ fare: 'kept' }]);
  });

  it('accepts legacy detailSource without provider itinerary', () => {
    const parsed = meetingSearchJourneyDetailDataSchema.parse({
      journeyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      detailSource: 'legacy',
      itineraryId: null,
      providerItinerary: null,
      legs: compactJourney.legs,
      providerItineraryUnavailableReason: null,
    });
    expect(parsed.detailSource).toBe('legacy');
    expect(parsed.providerItinerary).toBeNull();
  });
});
