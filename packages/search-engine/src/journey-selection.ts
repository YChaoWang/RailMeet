import { ARRIVAL_TOLERANCE_MS } from '@railmeet/shared';

import type { RankingJourneyInput, SelectedParticipantJourney } from './ranking-types.js';

export class RankingInputError extends Error {
  readonly code = 'RANKING_INPUT_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RankingInputError';
  }
}

/** Deterministic binary string ordering (not locale-dependent). */
export function compareBinaryStrings(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Lexicographic comparison of journey-ID tuples (element by element).
 * Participant order is fixed by the caller (binary-sorted participant ids).
 */
export function compareJourneyIdTuples(left: readonly string[], right: readonly string[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const cmp = compareBinaryStrings(left[index]!, right[index]!);
    if (cmp !== 0) {
      return cmp;
    }
  }
  return left.length - right.length;
}

export function assertValidJourney(journey: RankingJourneyInput): void {
  if (!Number.isFinite(journey.durationMinutes) || journey.durationMinutes < 0) {
    throw new RankingInputError(`Invalid duration for journey ${journey.journeyId}`);
  }
  if (!Number.isFinite(journey.transfers) || journey.transfers < 0) {
    throw new RankingInputError(`Invalid transfers for journey ${journey.journeyId}`);
  }
  if (!(journey.departureAt instanceof Date) || Number.isNaN(journey.departureAt.getTime())) {
    throw new RankingInputError(`Invalid departure for journey ${journey.journeyId}`);
  }
  if (!(journey.arrivalAt instanceof Date) || Number.isNaN(journey.arrivalAt.getTime())) {
    throw new RankingInputError(`Invalid arrival for journey ${journey.journeyId}`);
  }
  if (journey.arrivalAt.getTime() < journey.departureAt.getTime()) {
    throw new RankingInputError(`Arrival before departure for journey ${journey.journeyId}`);
  }
}

function toSelected(journey: RankingJourneyInput): SelectedParticipantJourney {
  return {
    participantId: journey.participantId,
    journeyId: journey.journeyId,
    durationMinutes: journey.durationMinutes,
    transfers: journey.transfers,
    departureAt: journey.departureAt,
    arrivalAt: journey.arrivalAt,
  };
}

function compareFastest(a: RankingJourneyInput, b: RankingJourneyInput): number {
  return (
    a.durationMinutes - b.durationMinutes ||
    a.transfers - b.transfers ||
    a.arrivalAt.getTime() - b.arrivalAt.getTime() ||
    a.departureAt.getTime() - b.departureAt.getTime() ||
    compareBinaryStrings(a.journeyId, b.journeyId)
  );
}

function compareFewestTransfers(a: RankingJourneyInput, b: RankingJourneyInput): number {
  return (
    a.transfers - b.transfers ||
    a.durationMinutes - b.durationMinutes ||
    a.arrivalAt.getTime() - b.arrivalAt.getTime() ||
    a.departureAt.getTime() - b.departureAt.getTime() ||
    compareBinaryStrings(a.journeyId, b.journeyId)
  );
}

/**
 * Within a fixed-width minimum spread window, pick one journey per participant.
 * Contracted local keys only: duration → transfers → binary journey ID.
 * Arrival/departure are not per-participant fields in the journey-set contract;
 * they are compared at set level (latest/earliest) across windows.
 */
function compareArriveTogetherPick(a: TimedJourney, b: TimedJourney): number {
  return (
    a.durationMinutes - b.durationMinutes ||
    a.transfers - b.transfers ||
    compareBinaryStrings(a.journeyId, b.journeyId)
  );
}

export function selectFastestJourneys(
  journeysByParticipant: ReadonlyMap<string, readonly RankingJourneyInput[]>,
): readonly SelectedParticipantJourney[] {
  const selected: SelectedParticipantJourney[] = [];
  for (const participantId of [...journeysByParticipant.keys()].sort(compareBinaryStrings)) {
    const journeys = [...(journeysByParticipant.get(participantId) ?? [])];
    if (journeys.length === 0) {
      throw new RankingInputError(`No journeys for participant ${participantId}`);
    }
    for (const journey of journeys) {
      assertValidJourney(journey);
    }
    journeys.sort(compareFastest);
    selected.push(toSelected(journeys[0]!));
  }
  return selected;
}

export function selectFewestTransferJourneys(
  journeysByParticipant: ReadonlyMap<string, readonly RankingJourneyInput[]>,
): readonly SelectedParticipantJourney[] {
  const selected: SelectedParticipantJourney[] = [];
  for (const participantId of [...journeysByParticipant.keys()].sort(compareBinaryStrings)) {
    const journeys = [...(journeysByParticipant.get(participantId) ?? [])];
    if (journeys.length === 0) {
      throw new RankingInputError(`No journeys for participant ${participantId}`);
    }
    for (const journey of journeys) {
      assertValidJourney(journey);
    }
    journeys.sort(compareFewestTransfers);
    selected.push(toSelected(journeys[0]!));
  }
  return selected;
}

type TimedJourney = RankingJourneyInput & { readonly arrivalMs: number };

type JourneySetScore = {
  readonly spread: number;
  readonly arrivalPenalty: number;
  readonly maxDuration: number;
  readonly totalDuration: number;
  readonly totalTransfers: number;
  readonly latestArrival: number;
  readonly earliestArrival: number;
  /** Journey IDs in binary-sorted participant order (never joined for comparison). */
  readonly journeyIds: readonly string[];
  readonly selected: readonly SelectedParticipantJourney[];
};

function scoreJourneySet(
  participantIds: readonly string[],
  chosenByParticipant: ReadonlyMap<string, TimedJourney>,
): JourneySetScore {
  const selected = participantIds.map((participantId) =>
    toSelected(chosenByParticipant.get(participantId)!),
  );
  const earliestArrival = Math.min(...selected.map((j) => j.arrivalAt.getTime()));
  const latestArrival = Math.max(...selected.map((j) => j.arrivalAt.getTime()));
  const spread = latestArrival - earliestArrival;
  return {
    spread,
    arrivalPenalty: Math.max(0, spread - ARRIVAL_TOLERANCE_MS),
    maxDuration: Math.max(...selected.map((j) => j.durationMinutes)),
    totalDuration: selected.reduce((sum, j) => sum + j.durationMinutes, 0),
    totalTransfers: selected.reduce((sum, j) => sum + j.transfers, 0),
    latestArrival,
    earliestArrival,
    journeyIds: selected.map((j) => j.journeyId),
    selected,
  };
}

function isBetterJourneySet(candidate: JourneySetScore, best: JourneySetScore): boolean {
  return (
    candidate.arrivalPenalty < best.arrivalPenalty ||
    (candidate.arrivalPenalty === best.arrivalPenalty &&
      candidate.maxDuration < best.maxDuration) ||
    (candidate.arrivalPenalty === best.arrivalPenalty &&
      candidate.maxDuration === best.maxDuration &&
      candidate.totalDuration < best.totalDuration) ||
    (candidate.arrivalPenalty === best.arrivalPenalty &&
      candidate.maxDuration === best.maxDuration &&
      candidate.totalDuration === best.totalDuration &&
      candidate.totalTransfers < best.totalTransfers) ||
    (candidate.arrivalPenalty === best.arrivalPenalty &&
      candidate.maxDuration === best.maxDuration &&
      candidate.totalDuration === best.totalDuration &&
      candidate.totalTransfers === best.totalTransfers &&
      candidate.spread < best.spread) ||
    (candidate.arrivalPenalty === best.arrivalPenalty &&
      candidate.maxDuration === best.maxDuration &&
      candidate.totalDuration === best.totalDuration &&
      candidate.totalTransfers === best.totalTransfers &&
      candidate.spread === best.spread &&
      candidate.latestArrival < best.latestArrival) ||
    (candidate.arrivalPenalty === best.arrivalPenalty &&
      candidate.maxDuration === best.maxDuration &&
      candidate.totalDuration === best.totalDuration &&
      candidate.totalTransfers === best.totalTransfers &&
      candidate.spread === best.spread &&
      candidate.latestArrival === best.latestArrival &&
      compareJourneyIdTuples(candidate.journeyIds, best.journeyIds) < 0)
  );
}

function findMinimumArrivalSpread(
  timed: readonly TimedJourney[],
  participantCount: number,
): number {
  const counts = new Map<string, number>();
  let covered = 0;
  let left = 0;
  let minSpread = Number.POSITIVE_INFINITY;

  for (let right = 0; right < timed.length; right += 1) {
    const add = timed[right]!;
    const prev = counts.get(add.participantId) ?? 0;
    counts.set(add.participantId, prev + 1);
    if (prev === 0) {
      covered += 1;
    }

    while (covered === participantCount && left <= right) {
      minSpread = Math.min(minSpread, timed[right]!.arrivalMs - timed[left]!.arrivalMs);
      const remove = timed[left]!;
      const next = (counts.get(remove.participantId) ?? 0) - 1;
      if (next <= 0) {
        counts.delete(remove.participantId);
        covered -= 1;
      } else {
        counts.set(remove.participantId, next);
      }
      left += 1;
    }
  }

  if (!Number.isFinite(minSpread)) {
    throw new RankingInputError('Arrive-together selection failed');
  }
  return minSpread;
}

/**
 * Arrive-together journey selection with a shared arrival tolerance.
 *
 * 1. Sort journeys by absolute UTC arrival.
 * 2. Find the global minimum covering spread D.
 * 3. Evaluate inclusive windows of width
 *      allowedWindowMs = max(ARRIVAL_TOLERANCE_MS, D)
 *    that still cover every participant.
 * 4. Inside each window pick duration → transfers → binary journeyId.
 * 5. Keep the best set under
 *      arrivalPenalty → maxDuration → totalDuration → totalTransfers →
 *      arrivalSpread → latestArrival → element-wise journey-ID tuple
 *    where arrivalPenalty = max(0, spread − ARRIVAL_TOLERANCE_MS).
 */
export function selectArriveTogetherJourneys(
  journeysByParticipant: ReadonlyMap<string, readonly RankingJourneyInput[]>,
): readonly SelectedParticipantJourney[] {
  const participantIds = [...journeysByParticipant.keys()].sort(compareBinaryStrings);
  if (participantIds.length === 0) {
    return [];
  }

  const timed: TimedJourney[] = [];
  for (const participantId of participantIds) {
    const journeys = journeysByParticipant.get(participantId) ?? [];
    if (journeys.length === 0) {
      throw new RankingInputError(`No journeys for participant ${participantId}`);
    }
    for (const journey of journeys) {
      assertValidJourney(journey);
      if (journey.participantId !== participantId) {
        throw new RankingInputError(`Journey ${journey.journeyId} has wrong participant`);
      }
      timed.push({ ...journey, arrivalMs: journey.arrivalAt.getTime() });
    }
  }

  timed.sort(
    (a, b) =>
      a.arrivalMs - b.arrivalMs ||
      compareBinaryStrings(a.journeyId, b.journeyId) ||
      compareBinaryStrings(a.participantId, b.participantId),
  );

  const minSpread = findMinimumArrivalSpread(timed, participantIds.length);
  const allowedWindowMs = Math.max(ARRIVAL_TOLERANCE_MS, minSpread);
  let best: JourneySetScore | undefined;

  for (let leftIndex = 0; leftIndex < timed.length; leftIndex += 1) {
    if (leftIndex > 0 && timed[leftIndex]!.arrivalMs === timed[leftIndex - 1]!.arrivalMs) {
      continue;
    }
    const lower = timed[leftIndex]!.arrivalMs;
    const upper = lower + allowedWindowMs;

    const optionsByParticipant = new Map<string, TimedJourney[]>();
    for (const journey of timed) {
      if (journey.arrivalMs < lower) {
        continue;
      }
      if (journey.arrivalMs > upper) {
        break;
      }
      const list = optionsByParticipant.get(journey.participantId) ?? [];
      list.push(journey);
      optionsByParticipant.set(journey.participantId, list);
    }
    if (optionsByParticipant.size !== participantIds.length) {
      continue;
    }

    const chosen = new Map<string, TimedJourney>();
    for (const participantId of participantIds) {
      const options = optionsByParticipant.get(participantId)!;
      let pick = options[0]!;
      for (let index = 1; index < options.length; index += 1) {
        const candidate = options[index]!;
        if (compareArriveTogetherPick(candidate, pick) < 0) {
          pick = candidate;
        }
      }
      chosen.set(participantId, pick);
    }

    const scored = scoreJourneySet(participantIds, chosen);
    if (!best || isBetterJourneySet(scored, best)) {
      best = scored;
    }
  }

  if (!best) {
    throw new RankingInputError('Arrive-together selection failed');
  }
  return best.selected;
}
