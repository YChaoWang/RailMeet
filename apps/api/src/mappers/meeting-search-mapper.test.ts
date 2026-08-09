import type { CreateMeetingSearchCommand, MeetingSearchRecord } from '@railmeet/database';
import type { CreateMeetingSearchRequest } from '@railmeet/validation';
import { describe, expect, it } from 'vitest';

import {
  toCreateMeetingSearchCommand,
  toMeetingSearchAcceptedData,
  toMeetingSearchDetailData,
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
});
