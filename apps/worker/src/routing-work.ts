import {
  isDatabaseUnavailableError,
  type MeetingSearchRepository,
  type PlaceRepository,
  type SearchPipelineRepository,
} from '@railmeet/database';
import type { Logger } from '@railmeet/observability';
import { UnrecoverableError, type RoutingJobResult, type RoutingProcessor } from '@railmeet/queue';
import {
  collectJourneyTransportModes,
  hasUnmappedTransitLegs,
  RoutingError,
  type JourneyPlanner,
} from '@railmeet/routing';
import { pickJourneyLegIdentity, SEARCH_LIMITS } from '@railmeet/shared';
import { wallTimeInZoneToUtc } from '@railmeet/search-engine';

export type CreateRoutingWorkProcessorOptions = {
  readonly meetingSearches: MeetingSearchRepository;
  readonly places: PlaceRepository;
  readonly searchPipeline: SearchPipelineRepository;
  readonly journeyPlanner: JourneyPlanner;
  readonly logger: Logger;
};

function isRetryableRoutingError(error: RoutingError): boolean {
  return (
    error.classification === 'transient' ||
    error.classification === 'rate_limited' ||
    error.classification === 'provider_unavailable' ||
    error.classification === 'shutdown'
  );
}

/**
 * Phase 7 routing processor: claim work, call Transitous once, persist normalized journeys.
 * Never marks the meeting search failed/completed.
 */
export function createRoutingWorkProcessor(
  options: CreateRoutingWorkProcessorOptions,
): RoutingProcessor {
  return async ({
    searchId,
    routingWorkId,
    jobId,
    attemptsMade,
    attemptsTotal,
  }): Promise<RoutingJobResult> => {
    try {
      const claim = await options.searchPipeline.claimRoutingWork(routingWorkId);
      if (claim.outcome === 'not_found') {
        throw new UnrecoverableError(`Routing work not found: ${routingWorkId}`);
      }
      if (claim.outcome === 'already_terminal') {
        const journeys = await options.searchPipeline.listJourneysForRoutingWork(routingWorkId);
        return {
          searchId,
          routingWorkId,
          outcome:
            claim.work.status === 'no_journeys'
              ? 'no_journeys'
              : claim.work.status === 'exhausted'
                ? 'exhausted'
                : 'already_terminal',
          journeyCount: journeys.length,
        };
      }

      // BullMQ redelivery after pending→running→transient failure must reclaim the same
      // row (status stays `running`; started_at is not reset). If journeys were already
      // persisted in a prior attempt, finish without calling Transitous again.
      if (claim.outcome === 'already_running') {
        const existing = await options.searchPipeline.listJourneysForRoutingWork(routingWorkId);
        if (existing.length > 0) {
          await options.searchPipeline.completeRoutingWorkWithJourneys({
            routingWorkId,
            status: 'succeeded',
            journeys: [],
          });
          options.logger.info(
            {
              event: 'routing_work_reclaimed_without_provider',
              searchId,
              routingWorkId,
              jobId,
              journeyCount: existing.length,
            },
            'Routing work reclaimed after prior journey persistence',
          );
          return {
            searchId,
            routingWorkId,
            outcome: 'succeeded',
            journeyCount: existing.length,
          };
        }
      }

      const work = claim.work;
      const search = await options.meetingSearches.findById(searchId);
      if (!search) {
        throw new UnrecoverableError(`Meeting search not found: ${searchId}`);
      }

      const participant = search.participants.find(
        (entry) => entry.participantId === work.participantId,
      );
      if (!participant) {
        await options.searchPipeline.markRoutingWorkExhausted(
          routingWorkId,
          'PARTICIPANT_NOT_FOUND',
        );
        throw new UnrecoverableError(`Participant missing on search for routing work`);
      }

      const [origin, destinationPlace, candidates] = await Promise.all([
        options.places.findById(participant.originPlaceId),
        options.places.findById(work.destinationPlaceId),
        options.searchPipeline.listCandidates(searchId),
      ]);
      if (!origin || !destinationPlace) {
        await options.searchPipeline.markRoutingWorkExhausted(routingWorkId, 'PLACE_NOT_FOUND');
        throw new UnrecoverableError('Origin or destination place missing');
      }

      const candidate = candidates.find(
        (row) => row.destinationPlaceId === work.destinationPlaceId,
      );
      const routingTargetPlaceId = candidate?.routingHubPlaceId ?? work.destinationPlaceId;
      const routingTarget =
        routingTargetPlaceId === destinationPlace.id
          ? destinationPlace
          : ((await options.places.findById(routingTargetPlaceId)) ?? destinationPlace);

      const departureAt = wallTimeInZoneToUtc(
        search.travelDate,
        search.earliestDepartureTime,
        origin.timezone,
      );

      const totalRoutingWork = await options.searchPipeline.countRoutingWorkForSearch(searchId);
      if (totalRoutingWork > SEARCH_LIMITS.maximumTotalPlanCalls) {
        await options.searchPipeline.markRoutingWorkExhausted(
          routingWorkId,
          'PLAN_BUDGET_EXCEEDED',
        );
        return {
          searchId,
          routingWorkId,
          outcome: 'exhausted',
          journeyCount: 0,
        };
      }

      let planResult;
      try {
        planResult = await options.journeyPlanner.planJourney({
          origin: {
            latitude: origin.location.latitude,
            longitude: origin.location.longitude,
          },
          destination: {
            latitude: routingTarget.location.latitude,
            longitude: routingTarget.location.longitude,
          },
          departureAt,
          maxTransfers: search.maxTransfers,
        });
      } catch (error) {
        if (error instanceof RoutingError) {
          if (isRetryableRoutingError(error)) {
            const willExhaust = attemptsTotal !== undefined && attemptsMade + 1 >= attemptsTotal;
            if (willExhaust) {
              await options.searchPipeline.markRoutingWorkExhausted(routingWorkId, error.code);
              return {
                searchId,
                routingWorkId,
                outcome: 'exhausted',
                journeyCount: 0,
              };
            }
            throw error;
          }
          await options.searchPipeline.markRoutingWorkExhausted(routingWorkId, error.code);
          throw new UnrecoverableError(`Routing permanently failed: ${error.code}`);
        }
        throw error;
      }

      // Reject transit itineraries whose legs are only unmapped (`other`) modes —
      // never persist a silent empty transportModes list for real transit.
      const usableJourneys = planResult.journeys.filter((journey) => {
        const modes = collectJourneyTransportModes(journey.legs);
        const hasTransitLeg = journey.legs.some((leg) => leg.mode !== 'walk');
        if (hasTransitLeg && modes.length === 0 && hasUnmappedTransitLegs(journey.legs)) {
          return false;
        }
        return true;
      });

      const journeys = usableJourneys.map((journey, journeyOrdinal) => {
        const transportModes = collectJourneyTransportModes(journey.legs);
        return {
          journeyOrdinal,
          departureAt: journey.departureAt,
          arrivalAt: journey.arrivalAt,
          durationMinutes: journey.durationMinutes,
          transfers: journey.transfers,
          transportModes,
          legs: journey.legs.map((leg) => ({
            mode: leg.mode,
            departureAt: leg.departureAt,
            arrivalAt: leg.arrivalAt,
            durationMinutes: leg.durationMinutes,
            ...(leg.providerReference ? { providerReference: leg.providerReference } : {}),
            ...(leg.geometry ? { geometry: leg.geometry } : {}),
            ...pickJourneyLegIdentity(leg),
          })),
          ...(journey.providerReference ? { providerReference: journey.providerReference } : {}),
          ...(journey.providerItinerary ? { providerItinerary: journey.providerItinerary } : {}),
        };
      });

      const status = journeys.length === 0 ? 'no_journeys' : 'succeeded';
      await options.searchPipeline.completeRoutingWorkWithJourneys({
        routingWorkId,
        status,
        journeys,
      });

      options.logger.info(
        {
          event: 'routing_work_completed',
          searchId,
          routingWorkId,
          jobId,
          attemptsMade,
          journeyCount: journeys.length,
          status,
        },
        'Routing work completed',
      );

      return {
        searchId,
        routingWorkId,
        outcome: status,
        journeyCount: journeys.length,
      };
    } catch (error) {
      if (error instanceof UnrecoverableError) {
        throw error;
      }
      if (error instanceof RoutingError && isRetryableRoutingError(error)) {
        throw error;
      }
      if (isDatabaseUnavailableError(error)) {
        throw error;
      }
      options.logger.error(
        {
          event: 'routing_work_unexpected_error',
          searchId,
          routingWorkId,
          jobId,
        },
        'Unexpected routing work failure',
      );
      throw new UnrecoverableError(
        error instanceof Error ? error.message : 'Unexpected routing work failure',
      );
    }
  };
}
