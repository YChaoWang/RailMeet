'use client';

import type { MeetingSearchResultsData } from '@railmeet/validation';
import type { RankingMode } from '@railmeet/shared';
import { RANKING_MODES } from '@railmeet/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import {
  formatArrivalSpreadMs,
  formatDurationMinutes,
  emptyOutcomeMessage,
  RANKING_MODE_LABELS,
  rankingsForMode,
} from '@/lib/search-view-model';
import { candidateSelectionKey, type MapMissingGeometryNote } from '@/lib/map-markers';
import { travelerColorAt, travelerLetterAt } from '@/lib/traveler-identity';
import { cn } from '@/lib/utils';

function placeLabel(place: { placeId: string; name?: string | undefined }): string {
  return place.name ?? place.placeId;
}

type SearchResultsViewProps = {
  readonly results: MeetingSearchResultsData;
  readonly selectedKey: string | null;
  readonly onSelectCandidate: (key: string) => void;
  readonly rankingMode: RankingMode;
  readonly onRankingModeChange: (mode: RankingMode) => void;
  readonly emphasizedParticipantId?: string | null;
  readonly onEmphasizeParticipant?: (participantId: string | null) => void;
  readonly missingGeometry?: readonly MapMissingGeometryNote[];
};

export function SearchResultsView({
  results,
  selectedKey,
  onSelectCandidate,
  rankingMode,
  onRankingModeChange,
  emphasizedParticipantId = null,
  onEmphasizeParticipant,
  missingGeometry = [],
}: SearchResultsViewProps) {
  const availableModes = useMemo(() => {
    const present = new Set(results.rankings.map((row) => row.rankingMode));
    const ordered = RANKING_MODES.filter((mode) => present.has(mode));
    return ordered.length > 0 ? ordered : ([results.rankingMode] as RankingMode[]);
  }, [results]);

  useEffect(() => {
    if (!availableModes.includes(rankingMode) && availableModes[0]) {
      onRankingModeChange(availableModes[0]);
    }
  }, [availableModes, rankingMode, onRankingModeChange]);

  const candidates = rankingsForMode(results, rankingMode);

  if (results.completionOutcome !== 'ranked' || candidates.length === 0) {
    return (
      <div className="space-y-3" data-testid="results-empty">
        <h2 className="text-base font-semibold text-ink-950">
          We couldn’t find a workable meeting plan.
        </h2>
        <p className="text-sm text-ink-700">{emptyOutcomeMessage(results.completionOutcome)}</p>
        <Link
          className="inline-flex min-h-11 items-center text-sm font-medium text-teal-800 underline-offset-4 hover:underline"
          href="/search"
        >
          Start a new search
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="results-ranked">
      <div className="sticky top-0 z-[1] -mx-4 space-y-2 border-b border-ink-700/10 bg-white px-4 pb-3 pt-1">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-700">Ranking mode</p>
        <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Ranking modes">
          {availableModes.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={rankingMode === value}
              className={cn(
                'shrink-0 rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                rankingMode === value
                  ? 'bg-teal-600 text-white'
                  : 'bg-mist-100 text-ink-900 hover:bg-mist-100/80',
              )}
              onClick={() => onRankingModeChange(value)}
            >
              {RANKING_MODE_LABELS[value].title}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-700">{RANKING_MODE_LABELS[rankingMode].description}</p>
      </div>

      <ul className="space-y-2">
        {candidates.map((candidate) => {
          const key = candidateSelectionKey(
            candidate.rankingMode,
            candidate.rank,
            candidate.destination.placeId,
          );
          const selected = selectedKey === key;
          return (
            <li key={key}>
              <button
                type="button"
                className={cn(
                  'w-full rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
                  selected
                    ? 'border-teal-600 bg-teal-50/50'
                    : 'border-ink-700/10 hover:border-ink-700/25',
                )}
                aria-pressed={selected}
                onClick={() => onSelectCandidate(key)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-ink-700">Rank {candidate.rank}</p>
                    <p className="text-base font-semibold text-ink-950">
                      {placeLabel(candidate.destination)}
                    </p>
                  </div>
                  {candidate.recommended ? <Badge variant="success">Recommended</Badge> : null}
                </div>
                <p className="mt-2 text-xs text-ink-700">
                  Spread {formatArrivalSpreadMs(candidate.arrivalSpreadMs)} ·{' '}
                  {formatDurationMinutes(candidate.totalDurationMinutes)} combined ·{' '}
                  {candidate.totalTransfers} transfers
                </p>
                <p className="mt-1 text-xs text-ink-700">
                  {candidate.journeys
                    .map(
                      (journey) =>
                        `${journey.participantDisplayName} ${formatDurationMinutes(journey.durationMinutes)}`,
                    )
                    .join(' · ')}
                </p>
              </button>

              {selected ? (
                <div className="mt-2 rounded-xl border border-ink-700/10 px-3 py-2">
                  <Accordion type="single" collapsible defaultValue="details">
                    <AccordionItem value="details" className="border-none">
                      <AccordionTrigger className="py-2 text-sm">Journey details</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3">
                          {candidate.journeys.map((journey) => {
                            const missingForTraveler = missingGeometry.filter(
                              (note) => note.participantId === journey.participantId,
                            );
                            const emphasized =
                              !emphasizedParticipantId ||
                              emphasizedParticipantId === journey.participantId;
                            const letter = travelerLetterAt(journey.participantPosition);
                            const color = travelerColorAt(journey.participantPosition);
                            return (
                              <div
                                key={`legs-${journey.participantId}`}
                                style={{ opacity: emphasized ? 1 : 0.45 }}
                              >
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 font-medium text-ink-900 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                                  aria-pressed={emphasizedParticipantId === journey.participantId}
                                  onClick={() =>
                                    onEmphasizeParticipant?.(
                                      emphasizedParticipantId === journey.participantId
                                        ? null
                                        : journey.participantId,
                                    )
                                  }
                                >
                                  <span
                                    className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white"
                                    style={{ backgroundColor: color }}
                                    aria-hidden
                                  >
                                    {letter}
                                  </span>
                                  {journey.participantDisplayName}
                                </button>
                                <p className="text-xs text-ink-700">
                                  {placeLabel(journey.origin)} → {placeLabel(journey.destination)}
                                </p>
                                {journey.legs.length === 0 ? (
                                  <p className="mt-1 text-xs text-ink-700">
                                    Departure {new Date(journey.departureAt).toUTCString()} ·
                                    Arrival {new Date(journey.arrivalAt).toUTCString()}
                                  </p>
                                ) : (
                                  <ul className="mt-1 space-y-1 text-xs text-ink-700">
                                    {journey.legs.map((leg, index) => {
                                      const missing = missingForTraveler.some(
                                        (note) => note.legIndex === index,
                                      );
                                      return (
                                        <li key={`${journey.participantId}-${index}`}>
                                          {leg.mode}: {new Date(leg.departureAt).toUTCString()} →{' '}
                                          {new Date(leg.arrivalAt).toUTCString()} (
                                          {formatDurationMinutes(leg.durationMinutes)})
                                          {missing ? (
                                            <span className="mt-0.5 block text-amber-800">
                                              Route shape unavailable for this segment
                                            </span>
                                          ) : null}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Convenience wrapper for tests that do not drive selection state. */
export function SearchResultsViewStandalone({
  results,
}: {
  readonly results: MeetingSearchResultsData;
}) {
  const availableModes = useMemo(() => {
    const present = new Set(results.rankings.map((row) => row.rankingMode));
    const ordered = RANKING_MODES.filter((mode) => present.has(mode));
    return ordered.length > 0 ? ordered : ([results.rankingMode] as RankingMode[]);
  }, [results]);
  const [mode, setMode] = useState<RankingMode>(
    availableModes.includes(results.rankingMode) ? results.rankingMode : availableModes[0]!,
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const first = rankingsForMode(results, mode)[0];
    return first
      ? candidateSelectionKey(first.rankingMode, first.rank, first.destination.placeId)
      : null;
  });

  return (
    <SearchResultsView
      results={results}
      rankingMode={mode}
      onRankingModeChange={setMode}
      selectedKey={selectedKey}
      onSelectCandidate={setSelectedKey}
    />
  );
}
