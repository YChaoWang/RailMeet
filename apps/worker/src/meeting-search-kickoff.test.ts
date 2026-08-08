import { describe, expect, it, vi } from 'vitest';

import { UnrecoverableError } from '@railmeet/queue';
import { createLogger } from '@railmeet/observability';
import type { MeetingSearchRepository } from '@railmeet/database';

import { createMeetingSearchKickoffProcessor } from './meeting-search-kickoff.js';

describe('meeting-search kickoff processor', () => {
  it('maps repository outcomes and rejects missing searches permanently', async () => {
    const meetingSearches = {
      tryKickoff: vi
        .fn()
        .mockResolvedValueOnce({
          outcome: 'started',
          searchId: '11111111-1111-4111-8111-111111111111',
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
        })
        .mockResolvedValueOnce({
          outcome: 'already_started',
          searchId: '11111111-1111-4111-8111-111111111111',
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
        })
        .mockResolvedValueOnce({ outcome: 'not_found', searchId: 'missing' }),
    } as unknown as MeetingSearchRepository;

    const processor = createMeetingSearchKickoffProcessor({
      meetingSearches,
      logger: createLogger({ name: 'kickoff-test', level: 'silent', pretty: false }),
    });

    await expect(
      processor({
        searchId: '11111111-1111-4111-8111-111111111111',
        jobId: 'outbox-1',
        attemptsMade: 0,
      }),
    ).resolves.toEqual({
      searchId: '11111111-1111-4111-8111-111111111111',
      transition: 'started',
    });

    await expect(
      processor({
        searchId: '11111111-1111-4111-8111-111111111111',
        jobId: 'outbox-1',
        attemptsMade: 1,
      }),
    ).resolves.toEqual({
      searchId: '11111111-1111-4111-8111-111111111111',
      transition: 'already_started',
    });

    await expect(
      processor({ searchId: 'missing', jobId: 'outbox-2', attemptsMade: 0 }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
