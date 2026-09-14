'use client';

import type { MeetingSearchResultsData } from '@railmeet/validation';
import type { RankingMode } from '@railmeet/shared';
import { RANKING_MODES } from '@railmeet/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  formatArrivalSpreadMs,
  formatDurationMinutes,
  emptyOutcomeMessage,
  RANKING_MODE_LABELS,
  rankingsForMode,
} from '@/lib/search-view-model';
import { candidateSelectionKey, type MapMissingGeometryNote } from '@/lib/map-markers';
import { travelerLetterAt } from '@/lib/traveler-identity';
import { cn } from '@/lib/utils';
import { JourneyDetailsPanel } from '@/components/search/journey-details-panel';
import { JourneyRouteSummary } from '@/components/search/journey-itinerary-timeline';
import { ChatAssistant, ChatThread, ChatUser, ChatWaterfallItem } from '@/components/ui/chat';
import { PromptSuggestion } from '@/components/ui/prompt-suggestion';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TYPED_TEXT_GAP_MS, TypedText, typedTextDurationMs } from '@/components/ui/typed-text';

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
  /** When true, render inline in the planner panel without a nested sub-panel chrome. */
  readonly embedded?: boolean;
  readonly listHeader?: ReactNode;
  readonly listFooter?: ReactNode;
  readonly onNewSearch?: () => void;
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
  embedded = false,
  listHeader,
  listFooter,
  onNewSearch,
}: SearchResultsViewProps) {
  const [journeysOpen, setJourneysOpen] = useState(false);
  useEffect(() => {
    setJourneysOpen(false);
  }, [results.searchId]);
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
  const selected = candidates.find((candidate) => {
    return (
      candidateSelectionKey(
        candidate.rankingMode,
        candidate.rank,
        candidate.destination.placeId,
      ) === selectedKey
    );
  });

  if (results.completionOutcome !== 'ranked' || candidates.length === 0) {
    let emptyStep = 0;
    const nextEmpty = () => emptyStep++;
    return (
      <div className="min-w-0" data-testid="results-empty">
        <ChatThread key={results.searchId}>
          {listHeader ? (
            <ChatWaterfallItem index={nextEmpty()}>
              <ChatUser>{listHeader}</ChatUser>
            </ChatWaterfallItem>
          ) : null}
          <ChatAssistant>
            <ChatWaterfallItem index={nextEmpty()}>
              <TypedText
                as="h2"
                className="text-base font-semibold text-ink-950"
                text="We couldn’t find a workable meeting plan."
              />
            </ChatWaterfallItem>
            <ChatWaterfallItem index={nextEmpty()}>
              <TypedText
                className="text-sm text-ink-700"
                delayMs={
                  typedTextDurationMs('We couldn’t find a workable meeting plan.') +
                  TYPED_TEXT_GAP_MS
                }
                text={emptyOutcomeMessage(results.completionOutcome)}
              />
            </ChatWaterfallItem>
            <PromptSuggestion>
              <ChatWaterfallItem index={nextEmpty()}>
                <PromptSuggestion.Header>
                  <PromptSuggestion.Title>What can I help with?</PromptSuggestion.Title>
                  <PromptSuggestion.Description>
                    Start from a suggested prompt.
                  </PromptSuggestion.Description>
                </PromptSuggestion.Header>
              </ChatWaterfallItem>
              <PromptSuggestion.Items>
                <ChatWaterfallItem index={nextEmpty()}>
                  {onNewSearch ? (
                    <PromptSuggestion.Item onClick={onNewSearch}>
                      <PromptSuggestion.ItemTitle>Start a new search</PromptSuggestion.ItemTitle>
                      <PromptSuggestion.ItemDescription>
                        Try different origins, times, or modes.
                      </PromptSuggestion.ItemDescription>
                    </PromptSuggestion.Item>
                  ) : (
                    <PromptSuggestion.ItemLink href="/search">
                      <PromptSuggestion.ItemTitle>Start a new search</PromptSuggestion.ItemTitle>
                      <PromptSuggestion.ItemDescription>
                        Try different origins, times, or modes.
                      </PromptSuggestion.ItemDescription>
                    </PromptSuggestion.ItemLink>
                  )}
                </ChatWaterfallItem>
              </PromptSuggestion.Items>
            </PromptSuggestion>
          </ChatAssistant>
        </ChatThread>
      </div>
    );
  }

  let listStep = 0;
  const nextList = () => listStep++;

  return (
    <div className="min-w-0" data-testid="results-ranked" data-layout="stack">
      <div className={cn('min-w-0', journeysOpen && 'hidden')} data-testid="results-list">
        <ChatThread key={results.searchId}>
          {listHeader ? (
            <ChatWaterfallItem index={nextList()}>
              <ChatUser>{listHeader}</ChatUser>
            </ChatWaterfallItem>
          ) : null}
          <ChatAssistant>
            <ChatWaterfallItem index={nextList()}>
              <TypedText
                className="text-sm text-ink-950"
                text={`I ranked ${candidates.length} meeting ${candidates.length === 1 ? 'city' : 'cities'} by ${RANKING_MODE_LABELS[rankingMode].title.toLowerCase()}.`}
              />
            </ChatWaterfallItem>
            <ChatWaterfallItem index={nextList()}>
              <div
                className={cn(
                  embedded ? undefined : 'sticky top-0 z-[1] -mx-4 bg-white px-4 pb-3 pt-1',
                )}
                data-testid="ranking-mode-control"
              >
                <SegmentedControl
                  aria-label="Ranking modes"
                  value={rankingMode}
                  items={availableModes.map((value) => ({
                    value,
                    label: RANKING_MODE_LABELS[value].title,
                  }))}
                  onValueChange={onRankingModeChange}
                />
                <p
                  className="mt-2 text-xs leading-snug text-ink-700"
                  data-testid="ranking-mode-description"
                >
                  {RANKING_MODE_LABELS[rankingMode].description}
                </p>
              </div>
            </ChatWaterfallItem>

            <ol className="min-w-0 space-y-2">
              {candidates.map((candidate) => {
                const key = candidateSelectionKey(
                  candidate.rankingMode,
                  candidate.rank,
                  candidate.destination.placeId,
                );
                const isSelected = selectedKey === key;
                const city = placeLabel(candidate.destination);
                return (
                  <ChatWaterfallItem key={key} as="li" index={nextList()} className="min-w-0">
                    <button
                      type="button"
                      className={cn(
                        'flex w-full min-w-0 items-start gap-3 rounded-2xl border border-ink-700/10 bg-white px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950',
                        isSelected ? 'border-ink-950/20 bg-ink-950/5' : 'hover:bg-ink-950/5',
                      )}
                      aria-pressed={isSelected}
                      aria-expanded={journeysOpen && isSelected}
                      aria-label={`Rank ${candidate.rank} ${city}`}
                      data-testid="candidate-card"
                      onClick={() => {
                        onSelectCandidate(key);
                        setJourneysOpen(true);
                      }}
                    >
                      <span
                        className={cn(
                          'mt-0.5 w-5 shrink-0 text-sm tabular-nums',
                          isSelected ? 'font-semibold text-ink-950' : 'text-ink-700',
                        )}
                        aria-hidden
                      >
                        {candidate.rank}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-base font-semibold text-ink-950">
                          {city}
                        </span>
                        <p
                          className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-700"
                          data-testid="candidate-metrics"
                        >
                          <span>{formatArrivalSpreadMs(candidate.arrivalSpreadMs)} apart</span>
                          <span>
                            {formatDurationMinutes(candidate.totalDurationMinutes)} combined
                          </span>
                          <span>
                            {candidate.totalTransfers} change
                            {candidate.totalTransfers === 1 ? '' : 's'}
                          </span>
                        </p>
                        <span className="mt-2 flex flex-col gap-1.5">
                          {candidate.journeys.map((journey) => (
                            <span
                              key={journey.journeyId}
                              className="min-w-0"
                              data-testid="candidate-traveler"
                            >
                              <span className="flex max-w-full items-center gap-1.5">
                                <span
                                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink-950 text-[10px] font-bold text-white"
                                  aria-hidden
                                >
                                  {travelerLetterAt(journey.participantPosition)}
                                </span>
                                <span className="truncate text-sm text-ink-950">
                                  {journey.participantDisplayName}
                                </span>
                                <span className="shrink-0 tabular-nums text-sm text-ink-700">
                                  {formatDurationMinutes(journey.durationMinutes)}
                                </span>
                              </span>
                              {journey.routeSummary.length > 0 ? (
                              <JourneyRouteSummary
                                segments={journey.routeSummary}
                                className="mt-1"
                              />
                              ) : null}
                            </span>
                          ))}
                        </span>
                      </span>
                    </button>
                  </ChatWaterfallItem>
                );
              })}
            </ol>
            <PromptSuggestion>
              <ChatWaterfallItem index={nextList()}>
                <PromptSuggestion.Header>
                  <PromptSuggestion.Title>What next?</PromptSuggestion.Title>
                  <PromptSuggestion.Description>
                    Open a city or try another ranking.
                  </PromptSuggestion.Description>
                </PromptSuggestion.Header>
              </ChatWaterfallItem>
              <PromptSuggestion.Items>
                {candidates[0] ? (
                  <ChatWaterfallItem index={nextList()}>
                    <PromptSuggestion.Item
                      onClick={() => {
                        const first = candidates[0]!;
                        onSelectCandidate(
                          candidateSelectionKey(
                            first.rankingMode,
                            first.rank,
                            first.destination.placeId,
                          ),
                        );
                        setJourneysOpen(true);
                      }}
                    >
                      <PromptSuggestion.ItemTitle>
                        Open journeys for {placeLabel(candidates[0].destination)}
                      </PromptSuggestion.ItemTitle>
                      <PromptSuggestion.ItemDescription>
                        See each traveler’s route to this city.
                      </PromptSuggestion.ItemDescription>
                    </PromptSuggestion.Item>
                  </ChatWaterfallItem>
                ) : null}
                {availableModes
                  .filter((mode) => mode !== rankingMode)
                  .map((mode) => (
                    <ChatWaterfallItem key={mode} index={nextList()}>
                      <PromptSuggestion.Item onClick={() => onRankingModeChange(mode)}>
                        <PromptSuggestion.ItemTitle>
                          Rank by {RANKING_MODE_LABELS[mode].title}
                        </PromptSuggestion.ItemTitle>
                        <PromptSuggestion.ItemDescription>
                          {RANKING_MODE_LABELS[mode].description}
                        </PromptSuggestion.ItemDescription>
                      </PromptSuggestion.Item>
                    </ChatWaterfallItem>
                  ))}
              </PromptSuggestion.Items>
            </PromptSuggestion>
          </ChatAssistant>
          {listFooter ? (
            <ChatWaterfallItem index={nextList()}>{listFooter}</ChatWaterfallItem>
          ) : null}
        </ChatThread>
      </div>

      <div className={cn('min-w-0', !journeysOpen && 'hidden')} data-testid="results-journeys">
        {selected ? (
          <ChatAssistant key={journeysOpen ? `open-${selectedKey}` : 'closed'}>
            <div className="min-w-0">
              <ChatWaterfallItem index={0}>
                <div className="mb-4 flex items-start gap-2">
                  <button
                    type="button"
                    className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-ink-950 hover:bg-ink-950/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950"
                    onClick={() => setJourneysOpen(false)}
                    data-testid="journeys-back"
                  >
                    Back
                  </button>
                  <div className="min-w-0 pt-2">
                    <p className="text-xs text-ink-700">
                      Rank {selected.rank} · {formatArrivalSpreadMs(selected.arrivalSpreadMs)} apart
                    </p>
                    <h2 className="break-words text-xl font-semibold text-ink-950">
                      {placeLabel(selected.destination)}
                    </h2>
                  </div>
                </div>
              </ChatWaterfallItem>
              <div className="space-y-6">
                {selected.journeys.map((journey, journeyIndex) => {
                  const missingForTraveler = missingGeometry.filter(
                    (note) => note.participantId === journey.participantId,
                  );
                  const emphasized =
                    !emphasizedParticipantId || emphasizedParticipantId === journey.participantId;
                  const highlighted = emphasizedParticipantId === journey.participantId;
                  return (
                    <ChatWaterfallItem key={`legs-${journey.journeyId}`} index={journeyIndex + 1}>
                    <section
                      className="min-w-0 transition-opacity"
                      style={{ opacity: emphasized ? 1 : 0.45 }}
                      data-testid="journey-card"
                    >
                      <button
                        type="button"
                        className="flex min-h-11 w-full min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950"
                        aria-pressed={highlighted}
                        onClick={() =>
                          onEmphasizeParticipant?.(highlighted ? null : journey.participantId)
                        }
                      >
                        <span
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-950 text-[11px] font-bold text-white"
                          aria-hidden
                        >
                          {travelerLetterAt(journey.participantPosition)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-950">
                          {journey.participantDisplayName}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-ink-700">
                          {formatDurationMinutes(journey.durationMinutes)}
                        </span>
                      </button>
                      {missingForTraveler.length > 0 ? (
                        <p className="mt-1 text-xs text-ink-700">
                          Route shape unavailable for {missingForTraveler.length} segment
                          {missingForTraveler.length === 1 ? '' : 's'}
                        </p>
                      ) : null}
                      <div className="mt-1 min-w-0">
                        <JourneyDetailsPanel
                          searchId={results.searchId}
                          journeyId={journey.journeyId}
                          originLabel={placeLabel(journey.origin)}
                          destinationLabel={placeLabel(journey.destination)}
                        />
                      </div>
                    </section>
                    </ChatWaterfallItem>
                  );
                })}
              </div>
            </div>
          </ChatAssistant>
        ) : null}
      </div>
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
    const rows = rankingsForMode(results, mode);
    const first = rows.find((row) => row.rank === 1) ?? rows[0];
    return first
      ? candidateSelectionKey(first.rankingMode, first.rank, first.destination.placeId)
      : null;
  });

  useEffect(() => {
    const rows = rankingsForMode(results, mode);
    const first = rows.find((row) => row.rank === 1) ?? rows[0];
    setSelectedKey(
      first
        ? candidateSelectionKey(first.rankingMode, first.rank, first.destination.placeId)
        : null,
    );
  }, [results, mode]);

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
