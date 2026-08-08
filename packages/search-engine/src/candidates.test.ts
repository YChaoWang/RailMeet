import { describe, expect, it } from 'vitest';

import { assignCandidateOrdinals } from './candidates.js';

describe('assignCandidateOrdinals', () => {
  it('assigns stable ordinals and respects the candidate limit', () => {
    const ranked = assignCandidateOrdinals(
      [
        { placeId: 'place:a', distanceMeters: 10 },
        { placeId: 'place:b', distanceMeters: 20 },
        { placeId: 'place:c', distanceMeters: 30 },
      ],
      2,
    );
    expect(ranked).toEqual([
      { placeId: 'place:a', distanceMeters: 10, ordinal: 0 },
      { placeId: 'place:b', distanceMeters: 20, ordinal: 1 },
    ]);
  });

  it('keeps fewer cities than the limit without inventing replacements', () => {
    const ranked = assignCandidateOrdinals([{ placeId: 'place:a', distanceMeters: 1 }], 8);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.ordinal).toBe(0);
  });
});
