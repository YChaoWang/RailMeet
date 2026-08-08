import { compareBinaryStrings } from './journey-selection.js';
import type {
  CandidateEvaluationResult,
  FeasibilityReason,
  RankingCandidateInput,
  RankingRoutingWorkInput,
} from './ranking-types.js';

export type EvaluateFeasibilityInput = {
  readonly participantIds: readonly string[];
  readonly candidates: readonly RankingCandidateInput[];
  readonly routingWork: readonly RankingRoutingWorkInput[];
};

/**
 * Evaluate every candidate. Missing participant×candidate pairs are invariant violations.
 * `no_journeys` makes a candidate infeasible (domain). `exhausted` is technical_failure.
 */
export function evaluateCandidateFeasibility(
  input: EvaluateFeasibilityInput,
): readonly CandidateEvaluationResult[] {
  const orderedParticipants = [...input.participantIds].sort(compareBinaryStrings);
  const orderedCandidates = [...input.candidates].sort(
    (a, b) => a.ordinal - b.ordinal || compareBinaryStrings(a.candidateId, b.candidateId),
  );

  return orderedCandidates.map((candidate) => {
    const works = input.routingWork.filter(
      (work) => work.destinationPlaceId === candidate.destinationPlaceId,
    );
    const byParticipant = new Map(works.map((work) => [work.participantId, work]));

    let feasibility: FeasibilityReason = 'feasible';
    for (const participantId of orderedParticipants) {
      const work = byParticipant.get(participantId);
      if (!work) {
        feasibility = 'invariant_violation';
        break;
      }
      if (work.status === 'pending' || work.status === 'running') {
        feasibility = 'routing_incomplete';
        break;
      }
      if (work.status === 'exhausted') {
        feasibility = 'technical_failure';
        break;
      }
      if (work.status === 'no_journeys') {
        feasibility = 'participant_no_journeys';
        break;
      }
      if (work.status === 'succeeded' && work.journeys.length === 0) {
        feasibility = 'invariant_violation';
        break;
      }
    }

    if (feasibility === 'feasible' && byParticipant.size !== orderedParticipants.length) {
      feasibility = 'invariant_violation';
    }

    return {
      destinationPlaceId: candidate.destinationPlaceId,
      feasibility,
    };
  });
}
