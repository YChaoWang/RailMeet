import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '@railmeet/observability';
import type { JourneyPlanner, PlannedJourney } from '@railmeet/routing';
import { MOTIS_PLAN_ITINERARY_FORMAT } from '@railmeet/shared';

import { createRoutingWorkProcessor } from './routing-work.js';

const searchId = '11111111-1111-4111-8111-111111111111';
const routingWorkId = '22222222-2222-4222-8222-222222222222';

const richJourney: PlannedJourney = {
  departureAt: new Date('2026-09-15T08:00:00.000Z'),
  arrivalAt: new Date('2026-09-15T10:00:00.000Z'),
  durationMinutes: 120,
  transfers: 0,
  providerReference: 'itinerary:fixture:v1',
  providerItinerary: {
    format: MOTIS_PLAN_ITINERARY_FORMAT,
    motisPlanApiVersion: 'v5',
    motisOpenApiPin: 'motis@2.10.2:/api/v5/plan',
    itinerary: {
      duration: 7200,
      startTime: '2026-09-15T08:00:00Z',
      endTime: '2026-09-15T10:00:00Z',
      transfers: 0,
      id: 'itinerary:fixture:v1',
      legs: [
        {
          mode: 'HIGHSPEED_RAIL',
          displayName: 'ICE 148',
          agencyName: 'DB Fernverkehr AG',
          startTime: '2026-09-15T08:00:00Z',
          endTime: '2026-09-15T10:00:00Z',
          duration: 7200,
          from: { name: 'Berlin Hbf', track: '1' },
          to: { name: 'Hengelo', track: '2' },
          intermediateStops: [{ name: 'Hannover Hbf', track: '7' }],
          headsign: 'Amsterdam Centraal',
        },
      ],
    },
  },
  legs: [
    {
      mode: 'train',
      motisMode: 'HIGHSPEED_RAIL',
      displayName: 'ICE 148',
      agencyName: 'DB Fernverkehr AG',
      headsign: 'Amsterdam Centraal',
      from: { name: 'Berlin Hbf', track: '1' },
      to: { name: 'Hengelo', track: '2' },
      intermediateStopCount: 1,
      departureAt: new Date('2026-09-15T08:00:00.000Z'),
      arrivalAt: new Date('2026-09-15T10:00:00.000Z'),
      durationMinutes: 120,
      providerReference: 'trip:ice148',
    },
  ],
};

describe('createRoutingWorkProcessor persist contract', () => {
  it('passes providerItinerary and leg identity into completeRoutingWorkWithJourneys', async () => {
    const completeRoutingWorkWithJourneys = vi.fn().mockResolvedValue(undefined);
    const journeyPlanner: JourneyPlanner = {
      planJourney: vi.fn().mockResolvedValue({ journeys: [richJourney] }),
    };

    const processor = createRoutingWorkProcessor({
      meetingSearches: {
        findById: vi.fn().mockResolvedValue({
          id: searchId,
          maxTransfers: 2,
          travelDate: '2026-09-15',
          earliestDepartureTime: '08:00',
          participants: [
            {
              participantId: 'p1',
              originPlaceId: 'place:berlin',
              displayName: 'Alex',
              position: 0,
            },
          ],
        }),
      } as never,
      places: {
        findById: vi.fn().mockImplementation(async (id: string) => ({
          id,
          timezone: 'Europe/Berlin',
          location: { latitude: 52.52, longitude: 13.4 },
        })),
      } as never,
      searchPipeline: {
        claimRoutingWork: vi.fn().mockResolvedValue({
          outcome: 'claimed',
          work: {
            id: routingWorkId,
            searchId,
            participantId: 'p1',
            destinationPlaceId: 'place:hengelo',
            status: 'running',
          },
        }),
        listCandidates: vi.fn().mockResolvedValue([
          { destinationPlaceId: 'place:hengelo', routingHubPlaceId: null },
        ]),
        countRoutingWorkForSearch: vi.fn().mockResolvedValue(1),
        completeRoutingWorkWithJourneys,
        listJourneysForRoutingWork: vi.fn(),
        markRoutingWorkExhausted: vi.fn(),
      } as never,
      journeyPlanner,
      logger: createLogger({ name: 'routing-persist-test', level: 'silent', pretty: false }),
    });

    const result = await processor({
      searchId,
      routingWorkId,
      jobId: 'job-1',
      attemptsMade: 0,
      attemptsTotal: 3,
    });

    expect(result.outcome).toBe('succeeded');
    expect(completeRoutingWorkWithJourneys).toHaveBeenCalledTimes(1);
    const persisted = completeRoutingWorkWithJourneys.mock.calls[0]![0]!;
    expect(persisted.journeys).toHaveLength(1);
    const journey = persisted.journeys[0]!;
    expect(journey.providerItinerary?.format).toBe('motis-plan-itinerary-v1');
    expect(journey.providerItinerary?.itinerary.legs[0]).toMatchObject({
      displayName: 'ICE 148',
      agencyName: 'DB Fernverkehr AG',
      mode: 'HIGHSPEED_RAIL',
    });
    expect(journey.legs[0]).toMatchObject({
      mode: 'train',
      motisMode: 'HIGHSPEED_RAIL',
      displayName: 'ICE 148',
      agencyName: 'DB Fernverkehr AG',
      headsign: 'Amsterdam Centraal',
    });
  });
});
