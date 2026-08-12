import {
  isDatabaseUnavailableError,
  type MeetingSearchRepository,
  type PlaceRepository,
  type SearchPipelineRepository,
} from '@railmeet/database';
import { evaluateCatalogReadiness, selectRoutingTarget } from '@railmeet/catalog';
import type { Logger } from '@railmeet/observability';
import {
  UnrecoverableError,
  type CandidateGenerationJobResult,
  type CandidateGenerationProcessor,
} from '@railmeet/queue';
import { assignCandidateOrdinals } from '@railmeet/search-engine';
import { SEARCH_LIMITS } from '@railmeet/shared';

export type CreateCandidateGenerationProcessorOptions = {
  readonly meetingSearches: MeetingSearchRepository;
  readonly places: PlaceRepository;
  readonly searchPipeline: SearchPipelineRepository;
  readonly candidateLimit: number;
  readonly logger: Logger;
};

/**
 * Phase 7/9 candidate processor: catalog readiness, nearest cities, hub targets, routing fan-out.
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

      const catalogStatus = await options.searchPipeline.getMeetingCityCatalogStatus();
      const readiness = evaluateCatalogReadiness({
        activeCityCount: catalogStatus.activeCityCount,
        activeHubCount: catalogStatus.activeHubCount,
        citiesWithActiveHubs: catalogStatus.citiesWithActiveHubs,
        sourceVersion: null,
        fixtureCityCount: catalogStatus.fixtureCityCount,
        productionCityCount: catalogStatus.productionCityCount,
        productionHubCount: catalogStatus.productionHubCount,
        hubsWithProviderStopId: catalogStatus.hubsWithProviderStopId,
        tierEligibleCityCount: catalogStatus.tierEligibleCityCount,
        eligibleHubbedCityCount: catalogStatus.eligibleHubbedCityCount,
        tierEligibleWithoutHubCount: catalogStatus.tierEligibleWithoutHubCount,
      });
      if (!readiness.ready) {
        await options.searchPipeline.completeCandidateGeneration(
          searchId,
          'failed_permanent',
          readiness.code,
        );
        options.logger.error(
          {
            event: 'candidate_catalog_not_ready',
            searchId,
            jobId,
            errorCode: readiness.code,
            activeCityCount: readiness.activeCityCount,
            activeHubCount: readiness.activeHubCount,
          },
          readiness.message,
        );
        return {
          searchId,
          outcome: 'failed_permanent',
          candidateCount: 0,
          routingWorkCount: 0,
        };
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
        search.allowedCountryCodes.length > 0
          ? { allowedCountryCodes: search.allowedCountryCodes }
          : undefined,
      );
      const ranked = assignCandidateOrdinals(
        nearest.map((city) => ({
          placeId: city.placeId,
          distanceMeters: city.distanceMeters,
        })),
        options.candidateLimit,
      );

      if (ranked.length === 0) {
        const errorCode =
          search.allowedCountryCodes.length > 0
            ? 'NO_CANDIDATES_MATCH_CONSTRAINTS'
            : 'NO_CANDIDATES_IN_SEARCH_AREA';
        // Empty candidate set is a domain completion path via finalization (no_candidates),
        // not a permanent generation failure — persist zero candidates and succeed generation.
        const fanOut = await options.searchPipeline.persistCandidatesAndFanOut({
          searchId,
          candidates: [],
          participantIds: search.participants.map((participant) => participant.participantId),
          fanOutMaxOrdinal: SEARCH_LIMITS.initialCandidates - 1,
        });
        options.logger.info(
          {
            event: 'candidates_generated_empty',
            searchId,
            jobId,
            errorCode,
          },
          'No meeting cities matched the geographic search / constraints',
        );
        return {
          searchId,
          outcome: 'generated',
          candidateCount: fanOut.candidateCount,
          routingWorkCount: fanOut.routingWorkCount,
        };
      }

      const hubs = await options.searchPipeline.listActiveHubsForCities(
        ranked.map((city) => city.placeId),
      );
      const hubsByCity = new Map<string, Array<(typeof hubs)[number]>>();
      for (const hub of hubs) {
        const list = hubsByCity.get(hub.cityPlaceId) ?? [];
        list.push(hub);
        hubsByCity.set(hub.cityPlaceId, list);
      }

      const hubbedCandidates = ranked
        .map((city) => {
          const target = selectRoutingTarget(
            (hubsByCity.get(city.placeId) ?? []).map((hub) => ({
              hubPlaceId: hub.hubPlaceId,
              priority: hub.priority,
              distanceMeters: hub.distanceMeters,
              regional: hub.regional,
            })),
            { allowCentroidFallback: false },
          );
          if (target.reason !== 'hub' || !target.hubPlaceId) {
            return null;
          }
          return {
            placeId: city.placeId,
            distanceMeters: city.distanceMeters,
            routingHubPlaceId: target.hubPlaceId,
            routingTargetReason: 'hub' as const,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (hubbedCandidates.length === 0) {
        const fanOut = await options.searchPipeline.persistCandidatesAndFanOut({
          searchId,
          candidates: [],
          participantIds: search.participants.map((participant) => participant.participantId),
          fanOutMaxOrdinal: SEARCH_LIMITS.initialCandidates - 1,
        });
        options.logger.info(
          {
            event: 'candidates_generated_empty',
            searchId,
            jobId,
            errorCode: 'CANDIDATES_HAVE_NO_ROUTING_TARGET',
          },
          'Nearest cities lacked authoritative hubs; centroid fallback disabled',
        );
        return {
          searchId,
          outcome: 'generated',
          candidateCount: fanOut.candidateCount,
          routingWorkCount: fanOut.routingWorkCount,
        };
      }

      const fanOut = await options.searchPipeline.persistCandidatesAndFanOut({
        searchId,
        candidates: hubbedCandidates.map((city, index) => ({
          destinationPlaceId: city.placeId,
          ordinal: index,
          distanceMeters: city.distanceMeters,
          routingHubPlaceId: city.routingHubPlaceId,
          routingTargetReason: city.routingTargetReason,
        })),
        participantIds: search.participants.map((participant) => participant.participantId),
        fanOutMaxOrdinal: SEARCH_LIMITS.initialCandidates - 1,
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
