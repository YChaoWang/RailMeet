import type {
  CreateMeetingSearchCommand,
  MeetingSearchRecord,
  RankedResultsReadModel,
} from '@railmeet/database';
import { MOTIS_PLAN_ITINERARY_FORMAT } from '@railmeet/shared';
import type { CreateMeetingSearchRequest } from '@railmeet/validation';
import {
  meetingSearchJourneyDetailDataSchema,
  meetingSearchResultsDataSchema,
} from '@railmeet/validation';
import { describe, expect, it } from 'vitest';

import {
  toCreateMeetingSearchCommand,
  toMeetingSearchAcceptedData,
  toMeetingSearchDetailData,
  toMeetingSearchJourneyDetailData,
  toMeetingSearchResultsData,
} from './meeting-search-mapper.js';

const sampleRequest: CreateMeetingSearchRequest = {
  participants: [
    { id: 'p-b', displayName: 'Blake', origin: { placeId: 'place:paris', label: 'Paris' } },
    { id: 'p-a', displayName: 'Alex', origin: { placeId: 'place:berlin' } },
  ],
  travelDate: '2026-06-15',
  earliestDepartureTime: '08:00',
  latestArrivalTime: '22:30',
  arrivalDayOffset: 0,
  maxJourneyDurationMinutes: 480,
  maxTransfers: 2,
  minTransferDurationMinutes: 5,
  allowedTransportModes: ['bus', 'train'],
  allowedCountryCodes: ['FR', 'DE'],
  rankingMode: 'fairest',
};

describe('meeting-search mapper', () => {
  it('maps validated DTO to persistence command with positional participants', () => {
    const command: CreateMeetingSearchCommand = toCreateMeetingSearchCommand(sampleRequest);

    expect(command.status).toBe('queued');
    expect(command.participants).toEqual([
      {
        participantId: 'p-b',
        displayName: 'Blake',
        origin: { kind: 'existing', placeId: 'place:paris' },
        position: 0,
      },
      {
        participantId: 'p-a',
        displayName: 'Alex',
        origin: { kind: 'existing', placeId: 'place:berlin' },
        position: 1,
      },
    ]);
    expect(command.allowedTransportModes).toEqual(['bus', 'train']);
    expect(command.allowedCountryCodes).toEqual(['FR', 'DE']);
  });

  it('omits allowedCountryCodes when absent on the DTO', () => {
    const { allowedCountryCodes: _ignored, ...withoutCountries } = sampleRequest;
    const command = toCreateMeetingSearchCommand(withoutCountries);
    expect(command.allowedCountryCodes).toBeUndefined();
  });

  it('projects accepted and detail API shapes without internal IDs', () => {
    const record: MeetingSearchRecord = {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'completed',
      travelDate: '2026-06-15',
      earliestDepartureTime: '08:00',
      latestArrivalTime: '22:30',
      arrivalDayOffset: 0,
      maxJourneyDurationMinutes: 480,
      maxTransfers: 2,
      minTransferDurationMinutes: 5,
      rankingMode: 'fairest',
      participants: [
        {
          participantId: 'p-a',
          displayName: 'Alex',
          originPlaceId: 'place:berlin',
          position: 0,
        },
      ],
      allowedTransportModes: ['train'],
      allowedCountryCodes: ['DE'],
      startedAt: new Date('2026-06-01T10:01:00.000Z'),
      completedAt: new Date('2026-06-01T10:05:00.000Z'),
      failedAt: null,
      completionOutcome: 'ranked',
      failureCode: null,
      recommendedDestinationPlaceId: 'place:munich',
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
      updatedAt: new Date('2026-06-01T10:05:00.000Z'),
    };

    expect(toMeetingSearchAcceptedData(record)).toEqual({
      searchId: record.id,
      status: 'queued',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const detail = toMeetingSearchDetailData(
      record,
      new Map([
        [
          'place:berlin',
          {
            placeId: 'place:berlin',
            name: 'Berlin',
            longitude: 13.405,
            latitude: 52.52,
          },
        ],
        [
          'place:munich',
          {
            placeId: 'place:munich',
            name: 'Munich',
            longitude: 11.582,
            latitude: 48.1351,
          },
        ],
      ]),
    );
    expect(detail.participants[0]).toEqual({
      id: 'p-a',
      displayName: 'Alex',
      origin: {
        placeId: 'place:berlin',
        name: 'Berlin',
        longitude: 13.405,
        latitude: 52.52,
      },
    });
    expect(detail.startedAt).toBe('2026-06-01T10:01:00.000Z');
    expect(detail.completedAt).toBe('2026-06-01T10:05:00.000Z');
    expect(detail.completionOutcome).toBe('ranked');
    expect(detail.recommendedDestination).toEqual({
      placeId: 'place:munich',
      name: 'Munich',
      longitude: 11.582,
      latitude: 48.1351,
    });
    expect(detail).not.toHaveProperty('id');
    expect(JSON.stringify(detail)).not.toContain('position');
  });

  it('projects compact results with journeyId and routeSummary without providerItinerary', () => {
    const model: Extract<RankedResultsReadModel, { kind: 'completed' }> = {
      kind: 'completed',
      searchId: '44444444-4444-4444-8444-444444444444',
      completionOutcome: 'ranked',
      rankingMode: 'fairest',
      recommendedDestination: {
        placeId: 'place:york',
        name: 'York',
        longitude: -1.09,
        latitude: 53.96,
      },
      rankings: [
        {
          rankingMode: 'fairest',
          rank: 1,
          destination: {
            placeId: 'place:york',
            name: 'York',
            longitude: -1.09,
            latitude: 53.96,
          },
          recommended: true,
          totalDurationMinutes: 103,
          maxDurationMinutes: 103,
          durationRangeMinutes: 0,
          totalTransfers: 2,
          maxTransfers: 2,
          earliestArrivalAt: new Date('2026-09-15T09:58:00.000Z'),
          latestArrivalAt: new Date('2026-09-15T09:58:00.000Z'),
          arrivalSpreadMs: 0,
          journeys: [
            {
              journeyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              participantId: 'p1',
              participantDisplayName: 'Alex',
              participantPosition: 0,
              origin: {
                placeId: 'place:manchester',
                name: 'Manchester',
                longitude: -2.24,
                latitude: 53.48,
              },
              destination: {
                placeId: 'place:york',
                name: 'York',
                longitude: -1.09,
                latitude: 53.96,
              },
              departureAt: new Date('2026-09-15T08:15:00.000Z'),
              arrivalAt: new Date('2026-09-15T09:58:00.000Z'),
              durationMinutes: 103,
              transfers: 2,
              transportModes: ['tram', 'train'],
              legs: [
                {
                  mode: 'train',
                  departureAt: new Date('2026-09-15T08:23:00.000Z'),
                  arrivalAt: new Date('2026-09-15T09:22:00.000Z'),
                  durationMinutes: 59,
                  geometry: null,
                  displayName: 'TPE',
                },
              ],
              routeSummary: [
                {
                  mode: 'REGIONAL_RAIL',
                  displayName: 'TPE',
                  routeColor: '#09a4ec',
                },
              ],
              providerItinerary: {
                format: MOTIS_PLAN_ITINERARY_FORMAT,
                motisPlanApiVersion: 'v5',
                motisOpenApiPin: 'motis@2.10.2:/api/v5/plan',
                itinerary: {
                  duration: 6180,
                  startTime: '2026-09-15T08:15:00Z',
                  endTime: '2026-09-15T09:58:00Z',
                  transfers: 2,
                  id: 'itinerary:fixture:manchester-york:v1',
                  legs: [
                    {
                      mode: 'REGIONAL_RAIL',
                      startTime: '2026-09-15T08:23:00Z',
                      endTime: '2026-09-15T09:22:00Z',
                      duration: 3540,
                      displayName: 'TPE',
                      agencyName: 'TransPennine Express',
                      alerts: [{ headerText: 'Special Service' }],
                      intermediateStops: [{ name: 'Huddersfield', track: '4' }],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
      queryCount: 1,
    };

    const data = toMeetingSearchResultsData(model);
    const parsed = meetingSearchResultsDataSchema.parse(data);
    const journey = parsed.rankings[0]?.journeys[0];
    expect(journey?.journeyId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(journey?.routeSummary[0]).toMatchObject({
      mode: 'REGIONAL_RAIL',
      displayName: 'TPE',
      routeColor: '#09a4ec',
    });
    expect(JSON.stringify(parsed)).not.toContain('providerItinerary');
    expect(JSON.stringify(parsed)).not.toContain('itineraryId');
    expect(JSON.stringify(parsed)).not.toContain('Special Service');
  });

  it('maps provider and legacy journey detail discriminators', () => {
    const provider = toMeetingSearchJourneyDetailData({
      journeyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      detailSource: 'provider',
      itineraryId: 'itinerary:fixture:manchester-york:v1',
      providerItinerary: {
        format: MOTIS_PLAN_ITINERARY_FORMAT,
        motisPlanApiVersion: 'v5',
        motisOpenApiPin: 'motis@2.10.2:/api/v5/plan',
        itinerary: {
          duration: 6180,
          startTime: '2026-09-15T08:15:00Z',
          endTime: '2026-09-15T09:58:00Z',
          transfers: 2,
          id: 'itinerary:fixture:manchester-york:v1',
          legs: [
            {
              mode: 'REGIONAL_RAIL',
              startTime: '2026-09-15T08:23:00Z',
              endTime: '2026-09-15T09:22:00Z',
              duration: 3540,
              displayName: 'TPE',
              agencyName: 'TransPennine Express',
            },
          ],
        },
      },
      legs: [
        {
          mode: 'train',
          departureAt: new Date('2026-09-15T08:23:00.000Z'),
          arrivalAt: new Date('2026-09-15T09:22:00.000Z'),
          durationMinutes: 59,
          geometry: null,
          displayName: 'TPE',
        },
      ],
      providerItineraryUnavailableReason: null,
    });
    expect(meetingSearchJourneyDetailDataSchema.parse(provider).detailSource).toBe('provider');
    expect(provider.providerItinerary?.itinerary.legs[0]).toMatchObject({
      displayName: 'TPE',
      agencyName: 'TransPennine Express',
    });

    const legacy = toMeetingSearchJourneyDetailData({
      journeyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      detailSource: 'legacy',
      itineraryId: null,
      providerItinerary: null,
      legs: [
        {
          mode: 'train',
          departureAt: new Date('2026-09-15T08:00:00.000Z'),
          arrivalAt: new Date('2026-09-15T10:00:00.000Z'),
          durationMinutes: 120,
          geometry: null,
        },
      ],
      providerItineraryUnavailableReason: null,
    });
    expect(meetingSearchJourneyDetailDataSchema.parse(legacy).detailSource).toBe('legacy');
    expect(legacy.providerItinerary).toBeNull();
  });
});
