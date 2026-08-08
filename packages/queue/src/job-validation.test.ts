import { describe, expect, it } from 'vitest';

import { MEETING_SEARCH_REQUESTED_JOB_NAME } from './contract.js';
import { validateMeetingSearchRequestedJob } from './job-validation.js';

describe('meeting-search job validation', () => {
  it('accepts the exact Phase 5/6 job contract', () => {
    const result = validateMeetingSearchRequestedJob({
      name: MEETING_SEARCH_REQUESTED_JOB_NAME,
      data: {
        schemaVersion: 1,
        searchId: '11111111-1111-4111-8111-111111111111',
      },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects wrong name, schema, payload, and search id', () => {
    expect(
      validateMeetingSearchRequestedJob({
        name: 'other',
        data: { schemaVersion: 1, searchId: '11111111-1111-4111-8111-111111111111' },
      }).ok,
    ).toBe(false);
    expect(
      validateMeetingSearchRequestedJob({
        name: MEETING_SEARCH_REQUESTED_JOB_NAME,
        data: { schemaVersion: 2, searchId: '11111111-1111-4111-8111-111111111111' },
      }).ok,
    ).toBe(false);
    expect(
      validateMeetingSearchRequestedJob({
        name: MEETING_SEARCH_REQUESTED_JOB_NAME,
        data: { schemaVersion: 1, searchId: 'not-uuid' },
      }).ok,
    ).toBe(false);
    expect(
      validateMeetingSearchRequestedJob({
        name: MEETING_SEARCH_REQUESTED_JOB_NAME,
        data: {
          schemaVersion: 1,
          searchId: '11111111-1111-4111-8111-111111111111',
          extra: true,
        },
      }).ok,
    ).toBe(false);
  });
});
