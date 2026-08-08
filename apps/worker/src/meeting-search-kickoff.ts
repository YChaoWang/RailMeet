import { isDatabaseUnavailableError, type MeetingSearchRepository } from '@railmeet/database';
import type { Logger } from '@railmeet/observability';
import {
  UnrecoverableError,
  type MeetingSearchKickoffJobResult,
  type MeetingSearchKickoffProcessor,
} from '@railmeet/queue';

export type CreateMeetingSearchKickoffProcessorOptions = {
  readonly meetingSearches: MeetingSearchRepository;
  readonly logger: Logger;
};

/**
 * Phase 6 kickoff processor: durable queued → running transition only.
 * Does not call Transitous, invent destinations, or fabricate journey results.
 *
 * `running` means the asynchronous search pipeline accepted the search.
 * It does not mean routes or recommendations already exist.
 */
export function createMeetingSearchKickoffProcessor(
  options: CreateMeetingSearchKickoffProcessorOptions,
): MeetingSearchKickoffProcessor {
  return async ({ searchId, jobId, attemptsMade }): Promise<MeetingSearchKickoffJobResult> => {
    try {
      const result = await options.meetingSearches.tryKickoff(searchId);
      switch (result.outcome) {
        case 'started':
          options.logger.info(
            {
              event: 'search_transitioned_to_running',
              searchId,
              jobId,
              attemptsMade,
            },
            'Search transitioned to running',
          );
          return { searchId, transition: 'started' };
        case 'already_started':
          options.logger.info(
            {
              event: 'duplicate_search_kickoff_ignored',
              searchId,
              jobId,
              attemptsMade,
              transition: 'already_started',
            },
            'Duplicate search kickoff ignored',
          );
          return { searchId, transition: 'already_started' };
        case 'already_terminal':
          options.logger.info(
            {
              event: 'duplicate_search_kickoff_ignored',
              searchId,
              jobId,
              attemptsMade,
              transition: 'already_terminal',
              status: result.status,
            },
            'Terminal search kickoff ignored',
          );
          return { searchId, transition: 'already_terminal' };
        case 'not_found':
          throw new UnrecoverableError(`Meeting search not found: ${searchId}`);
      }
    } catch (error) {
      if (error instanceof UnrecoverableError) {
        throw error;
      }
      if (isDatabaseUnavailableError(error)) {
        throw error;
      }
      // Unknown programming / persistence bugs should not retry forever.
      options.logger.error(
        {
          event: 'search_kickoff_unexpected_error',
          searchId,
          jobId,
        },
        'Unexpected search kickoff failure',
      );
      throw new UnrecoverableError(
        error instanceof Error ? error.message : 'Unexpected search kickoff failure',
      );
    }
  };
}
