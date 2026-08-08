import {
  isDatabaseUnavailableError,
  type MeetingSearchRepository,
  type PlaceRepository,
  type SearchPipelineRepository,
} from '@railmeet/database';
import type { Logger } from '@railmeet/observability';
import {
  UnrecoverableError,
  type CandidateGenerationJobResult,
  type CandidateGenerationProcessor,
} from '@railmeet/queue';
import { assignCandidateOrdinals } from '@railmeet/search-engine';

export type CreateCandidateGenerationProcessorOptions = {
  readonly meetingSearches: MeetingSearchRepository;
  readonly places: PlaceRepository;
  readonly searchPipeline: SearchPipelineRepository;
  readonly candidateLimit: number;
  readonly logger: Logger;
};

/**
 * Phase 7 candidate processor: claim generation, PostGIS nearest cities, fan-out routing work.
 * Does not call Transitous.
 */
export function createCandidateGenerationProcessor(
  options: CreateCandidateGenerationProcessorOptions,
): CandidateGenerationProcessor {
  return async ({ searchId, jobId, attemptsMade }): Promise<CandidateGenerationJobResult> => {
    try {
      const claim = await options.searchPipeline.claimCandidateGeneration(searchId);
      if (claim.outcome === 'not_found') {
        throw new UnrecoverableError(`Candidate generation row missing for search ${searchId}`);
      }
      if (claim.outcome === 'already_succeeded') {
        const candidates = await options.searchPipeline.listCandidates(searchId);
        const routingWorkCount = await options.searchPipeline.countRoutingWorkForSearch(searchId);
        return {
          searchId,
          outcome: 'already_generated',
          candidateCount: candidates.length,
          routingWorkCount,
        };
      }
      if (claim.outcome === 'already_failed') {
        return {
          searchId,
          outcome: 'failed_permanent',
          candidateCount: 0,
          routingWorkCount: 0,
        };
      }

      const search = await options.meetingSearches.findById(searchId);
      if (!search) {
        await options.searchPipeline.completeCandidateGeneration(
          searchId,
          'failed_permanent',
          'SEARCH_NOT_FOUND',
        );
        throw new UnrecoverableError(`Meeting search not found: ${searchId}`);
      }

      const originIds = search.participants.map((participant) => participant.originPlaceId);
      const origins = await options.places.findManyByIds(originIds);
      if (origins.length !== originIds.length) {
        await options.searchPipeline.completeCandidateGeneration(
          searchId,
          'failed_permanent',
          'ORIGIN_PLACE_MISSING',
        );
        options.logger.error(
          {
            event: 'candidate_generation_failed_permanent',
            searchId,
            jobId,
            errorCode: 'ORIGIN_PLACE_MISSING',
          },
          'Candidate generation failed: missing origin places',
        );
        return {
          searchId,
          outcome: 'failed_permanent',
          candidateCount: 0,
          routingWorkCount: 0,
        };
      }

      const nearest = await options.searchPipeline.findNearestCityCandidates(
        originIds,
        options.candidateLimit,
      );
      const ranked = assignCandidateOrdinals(
        nearest.map((city) => ({
          placeId: city.placeId,
          distanceMeters: city.distanceMeters,
        })),
        options.candidateLimit,
      );

      const fanOut = await options.searchPipeline.persistCandidatesAndFanOut({
        searchId,
        candidates: ranked.map((city) => ({
          destinationPlaceId: city.placeId,
          ordinal: city.ordinal,
          distanceMeters: city.distanceMeters,
        })),
        participantIds: search.participants.map((participant) => participant.participantId),
      });

      options.logger.info(
        {
          event: 'candidates_generated',
          searchId,
          jobId,
          attemptsMade,
          candidateCount: fanOut.candidateCount,
          routingWorkCount: fanOut.routingWorkCount,
        },
        'Candidates generated and routing work enqueued via outbox',
      );

      return {
        searchId,
        outcome: 'generated',
        candidateCount: fanOut.candidateCount,
        routingWorkCount: fanOut.routingWorkCount,
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
          event: 'candidate_generation_unexpected_error',
          searchId,
          jobId,
        },
        'Unexpected candidate generation failure',
      );
      throw new UnrecoverableError(
        error instanceof Error ? error.message : 'Unexpected candidate generation failure',
      );
    }
  };
}
