import { isDatabaseUnavailableError, type FinalizationRepository } from '@railmeet/database';
import type { Logger } from '@railmeet/observability';
import { UnrecoverableError, type FinalizationProcessor } from '@railmeet/queue';

export type CreateFinalizationProcessorOptions = {
  readonly finalization: FinalizationRepository;
  readonly logger: Logger;
};

/**
 * Phase 8 finalization processor: readiness check, ranking persistence, search completion.
 */
export function createFinalizationProcessor(
  options: CreateFinalizationProcessorOptions,
): FinalizationProcessor {
  return async ({ searchId, jobId, attemptsMade }) => {
    try {
      const result = await options.finalization.finalizeMeetingSearch(searchId);
      options.logger.info(
        {
          event: 'finalization_processed',
          searchId,
          jobId,
          attemptsMade,
          outcome: result.outcome,
          ...(result.outcome === 'completed'
            ? { completionOutcome: result.completionOutcome }
            : {}),
          ...(result.outcome === 'failed' ? { failureCode: result.failureCode } : {}),
        },
        'Finalization processed',
      );

      if (result.outcome === 'not_ready') {
        return { searchId, outcome: 'not_ready' };
      }
      if (result.outcome === 'already_terminal') {
        return { searchId, outcome: 'already_terminal' };
      }
      if (result.outcome === 'failed') {
        return {
          searchId,
          outcome: 'failed',
          failureCode: result.failureCode,
        };
      }
      if (result.outcome === 'not_found') {
        throw new UnrecoverableError(`Meeting search not found: ${searchId}`);
      }
      return {
        searchId,
        outcome: 'completed',
        completionOutcome: result.completionOutcome,
      };
    } catch (error) {
      if (error instanceof UnrecoverableError) {
        throw error;
      }
      if (isDatabaseUnavailableError(error)) {
        throw error;
      }
      options.logger.error(
        {
          event: 'finalization_unexpected_error',
          searchId,
          jobId,
        },
        'Unexpected finalization failure',
      );
      throw new UnrecoverableError(
        error instanceof Error ? error.message : 'Unexpected finalization failure',
      );
    }
  };
}
