import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { createMeetingSearchRequestSchema } from './meeting-search.js';

type MeetingSearchInput = z.input<typeof createMeetingSearchRequestSchema>;

function validMeetingSearchRequest(
  overrides: Partial<MeetingSearchInput> = {},
): MeetingSearchInput {
  return {
    participants: [
      {
        id: 'p1',
        displayName: 'Alex',
        origin: { placeId: 'place:berlin-hbf', label: 'Berlin Hbf' },
      },
      {
        id: 'p2',
        displayName: 'Blake',
        origin: { placeId: 'place:paris-nord' },
      },
    ],
    travelDate: '2026-06-15',
    earliestDepartureTime: '08:00',
    latestArrivalTime: '22:00',
    arrivalDayOffset: 0,
    maxJourneyDurationMinutes: 480,
    maxTransfers: 2,
    minTransferDurationMinutes: 5,
    allowedTransportModes: ['train', 'bus'],
    allowedCountryCodes: ['DE', 'FR', 'BE'],
    rankingMode: 'fairest',
    ...overrides,
  };
}

function participant(
  id: string,
  displayName: string,
  placeId: string,
): MeetingSearchInput['participants'][number] {
  return {
    id,
    displayName,
    origin: { placeId },
  };
}

describe('createMeetingSearchRequestSchema', () => {
  it('accepts a fully valid meeting-search request', () => {
    const result = createMeetingSearchRequestSchema.safeParse(validMeetingSearchRequest());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.participants).toHaveLength(2);
      expect(result.data.rankingMode).toBe('fairest');
      expect(result.data.arrivalDayOffset).toBe(0);
    }
  });

  it('accepts exactly 2 participants', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [participant('a', 'Ada', 'place:a'), participant('b', 'Bea', 'place:b')],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts exactly 6 participants', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [
          participant('1', 'One', 'place:1'),
          participant('2', 'Two', 'place:2'),
          participant('3', 'Three', 'place:3'),
          participant('4', 'Four', 'place:4'),
          participant('5', 'Five', 'place:5'),
          participant('6', 'Six', 'place:6'),
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects fewer than 2 participants', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [participant('a', 'Ada', 'place:a')],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects more than 6 participants', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [
          participant('1', 'One', 'place:1'),
          participant('2', 'Two', 'place:2'),
          participant('3', 'Three', 'place:3'),
          participant('4', 'Four', 'place:4'),
          participant('5', 'Five', 'place:5'),
          participant('6', 'Six', 'place:6'),
          participant('7', 'Seven', 'place:7'),
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects duplicate participant IDs', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [participant('dup', 'Ada', 'place:a'), participant('dup', 'Bea', 'place:b')],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects participant IDs that collide only after trimming', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [
          participant('  dup  ', 'Ada', 'place:a'),
          participant('dup', 'Bea', 'place:b'),
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty or whitespace-only participant names', () => {
    const empty = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [participant('a', '', 'place:a'), participant('b', 'Bea', 'place:b')],
      }),
    );
    const whitespace = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [participant('a', '   ', 'place:a'), participant('b', 'Bea', 'place:b')],
      }),
    );
    expect(empty.success).toBe(false);
    expect(whitespace.success).toBe(false);
  });

  it('rejects missing or invalid place IDs', () => {
    const missing = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [
          { id: 'a', displayName: 'Ada', origin: { placeId: '' } },
          participant('b', 'Bea', 'place:b'),
        ],
      }),
    );
    const whitespace = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [
          { id: 'a', displayName: 'Ada', origin: { placeId: '  ' } },
          participant('b', 'Bea', 'place:b'),
        ],
      }),
    );
    expect(missing.success).toBe(false);
    expect(whitespace.success).toBe(false);
  });

  it('accepts a valid leap-day travel date', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({ travelDate: '2024-02-29' }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects an invalid calendar date', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({ travelDate: '2026-02-31' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts boundary local times 00:00 and 23:59', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        earliestDepartureTime: '00:00',
        latestArrivalTime: '23:59',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects invalid local times', () => {
    for (const time of ['24:00', '12:60', '9:00'] as const) {
      const departure = createMeetingSearchRequestSchema.safeParse(
        validMeetingSearchRequest({ earliestDepartureTime: time }),
      );
      const arrival = createMeetingSearchRequestSchema.safeParse(
        validMeetingSearchRequest({ latestArrivalTime: time }),
      );
      expect(departure.success).toBe(false);
      expect(arrival.success).toBe(false);
    }
  });

  it('rejects negative and non-integer duration or transfer values', () => {
    expect(
      createMeetingSearchRequestSchema.safeParse(
        validMeetingSearchRequest({ maxJourneyDurationMinutes: -1 }),
      ).success,
    ).toBe(false);
    expect(
      createMeetingSearchRequestSchema.safeParse(
        validMeetingSearchRequest({ maxJourneyDurationMinutes: 30.5 }),
      ).success,
    ).toBe(false);
    expect(
      createMeetingSearchRequestSchema.safeParse(validMeetingSearchRequest({ maxTransfers: -1 }))
        .success,
    ).toBe(false);
    expect(
      createMeetingSearchRequestSchema.safeParse(validMeetingSearchRequest({ maxTransfers: 1.5 }))
        .success,
    ).toBe(false);
    expect(
      createMeetingSearchRequestSchema.safeParse(
        validMeetingSearchRequest({ minTransferDurationMinutes: 0 }),
      ).success,
    ).toBe(false);
    expect(
      createMeetingSearchRequestSchema.safeParse(
        validMeetingSearchRequest({ minTransferDurationMinutes: 2.2 }),
      ).success,
    ).toBe(false);
  });

  it('rejects empty allowed transport modes', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({ allowedTransportModes: [] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects duplicate transport modes', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        allowedTransportModes: ['train', 'train'],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an invalid ranking mode', () => {
    const result = createMeetingSearchRequestSchema.safeParse({
      ...validMeetingSearchRequest(),
      rankingMode: 'cheapest',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid uppercase country codes', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({ allowedCountryCodes: ['DE', 'NL'] }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects lowercase or malformed country codes', () => {
    expect(
      createMeetingSearchRequestSchema.safeParse(
        validMeetingSearchRequest({ allowedCountryCodes: ['de'] }),
      ).success,
    ).toBe(false);
    expect(
      createMeetingSearchRequestSchema.safeParse(
        validMeetingSearchRequest({ allowedCountryCodes: ['D'] }),
      ).success,
    ).toBe(false);
    expect(
      createMeetingSearchRequestSchema.safeParse(
        validMeetingSearchRequest({ allowedCountryCodes: ['DEU'] }),
      ).success,
    ).toBe(false);
  });

  it('rejects duplicate country codes', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({ allowedCountryCodes: ['DE', 'DE'] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects unknown object keys', () => {
    const result = createMeetingSearchRequestSchema.safeParse({
      ...validMeetingSearchRequest(),
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts same-day and next-day arrival offsets', () => {
    expect(
      createMeetingSearchRequestSchema.safeParse(validMeetingSearchRequest({ arrivalDayOffset: 0 }))
        .success,
    ).toBe(true);
    expect(
      createMeetingSearchRequestSchema.safeParse(validMeetingSearchRequest({ arrivalDayOffset: 1 }))
        .success,
    ).toBe(true);
    expect(
      createMeetingSearchRequestSchema.safeParse(validMeetingSearchRequest({ arrivalDayOffset: 2 }))
        .success,
    ).toBe(false);
  });

  it('trims surrounding whitespace on string fields without repairing invalid values', () => {
    const result = createMeetingSearchRequestSchema.safeParse(
      validMeetingSearchRequest({
        participants: [
          {
            id: '  p1  ',
            displayName: '  Alex  ',
            origin: { placeId: '  place:berlin-hbf  ', label: '  Berlin  ' },
          },
          participant('p2', 'Blake', 'place:paris-nord'),
        ],
        travelDate: '  2026-06-15  ',
        earliestDepartureTime: '  08:00  ',
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.participants[0]?.id).toBe('p1');
      expect(result.data.participants[0]?.displayName).toBe('Alex');
      expect(result.data.participants[0]?.origin.placeId).toBe('place:berlin-hbf');
      expect(result.data.travelDate).toBe('2026-06-15');
      expect(result.data.earliestDepartureTime).toBe('08:00');
    }
  });

  it('defaults arrivalDayOffset to same-day when omitted', () => {
    const { arrivalDayOffset: _omitted, ...withoutOffset } = validMeetingSearchRequest();
    const result = createMeetingSearchRequestSchema.safeParse(withoutOffset);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.arrivalDayOffset).toBe(0);
    }
  });
});
