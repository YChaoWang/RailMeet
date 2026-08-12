'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { RankingMode } from '@railmeet/shared';
import type { MeetingSearchDetailData } from '@railmeet/validation';

import { usePlannerMap } from '@/components/search/planner-map-context';
import { SearchResultsView } from '@/components/search/search-results-view';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearchPolling } from '@/hooks/use-search-polling';
import { buildMapScene, candidateSelectionKey, type MapScene } from '@/lib/map-markers';
import { failureMessage, rankingsForMode, type SearchPageViewState } from '@/lib/search-view-model';
import { travelerColorAt, travelerLetterAt } from '@/lib/traveler-identity';

function summaryFromState(state: SearchPageViewState): MeetingSearchDetailData | null {
  switch (state.kind) {
    case 'queued':
    case 'running':
    case 'partially_completed':
    case 'cancelling':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return state.summary;
    case 'network_error':
      return state.summary;
    default:
      return null;
  }
}

export function SearchStatusPage({ searchId }: { readonly searchId: string }) {
  const {
    setScene,
    setPanelTitle,
    setCollapseSheetWhen,
    setSheetExpanded,
    setCandidateSelectHandler,
    setTravelerSelectHandler,
  } = usePlannerMap();
  const { state, retry } = useSearchPolling(searchId);
  const [rankingMode, setRankingMode] = useState<RankingMode>('fairest');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [emphasizedParticipantId, setEmphasizedParticipantId] = useState<string | null>(null);

  const summary = summaryFromState(state);
  const results = state.kind === 'completed' ? state.results : null;

  useEffect(() => {
    if (results?.rankingMode) {
      setRankingMode(results.rankingMode);
    }
  }, [results?.searchId, results?.rankingMode]);

  useEffect(() => {
    if (!results) {
      setSelectedKey(null);
      setEmphasizedParticipantId(null);
      return;
    }
    const modeRows = rankingsForMode(results, rankingMode);
    const first = modeRows.find((row) => row.rank === 1) ?? modeRows[0];
    if (!first) {
      setSelectedKey(null);
      return;
    }
    // Mode switches must select that mode's rank-1 winner (and its journey set).
    // Do not keep the previous destination — winners differ across modes.
    setSelectedKey(candidateSelectionKey(first.rankingMode, first.rank, first.destination.placeId));
  }, [results, rankingMode]);

  const scene: MapScene = useMemo(
    () =>
      buildMapScene({
        summary,
        results,
        rankingMode,
        selectedKey,
        emphasizedParticipantId,
      }),
    [summary, results, rankingMode, selectedKey, emphasizedParticipantId],
  );

  useEffect(() => {
    setPanelTitle(panelTitleFor(state.kind));
  }, [state.kind, setPanelTitle]);

  useEffect(() => {
    // Keep draft traveler markers on the persistent map until the first search summary arrives.
    if (
      (state.kind === 'loading' || state.kind === 'not_found') &&
      scene.markers.length === 0 &&
      scene.routeLines.length === 0
    ) {
      return;
    }
    setScene(scene);
  }, [scene, setScene, state.kind]);

  useEffect(() => {
    setCollapseSheetWhen(results?.searchId ?? null);
    if (!results) {
      setSheetExpanded(true);
    }
  }, [results?.searchId, results, setCollapseSheetWhen, setSheetExpanded]);

  useEffect(() => {
    setCandidateSelectHandler(setSelectedKey);
    setTravelerSelectHandler((participantId) => {
      setEmphasizedParticipantId((current) => (current === participantId ? null : participantId));
    });
    return () => {
      setCandidateSelectHandler(null);
      setTravelerSelectHandler(null);
    };
  }, [setCandidateSelectHandler, setTravelerSelectHandler]);

  return (
    <>
      {renderPanelBody({
        state,
        retry,
        rankingMode,
        setRankingMode,
        selectedKey,
        setSelectedKey,
        scene,
        emphasizedParticipantId,
        setEmphasizedParticipantId,
      })}
    </>
  );
}

function panelTitleFor(kind: SearchPageViewState['kind']): string {
  switch (kind) {
    case 'loading':
      return 'Loading search';
    case 'malformed_id':
      return 'Invalid link';
    case 'not_found':
      return 'Search not found';
    case 'queued':
      return 'Preparing the search';
    case 'running':
      return 'Comparing routes';
    case 'partially_completed':
      return 'Still refining';
    case 'cancelling':
      return 'Stopping';
    case 'completed':
      return 'Meeting points';
    case 'failed':
      return 'Search failed';
    case 'cancelled':
      return 'Search cancelled';
    case 'network_error':
      return 'Connection issue';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function RouteLegend({
  scene,
  emphasizedParticipantId,
  onSelect,
}: {
  readonly scene: MapScene;
  readonly emphasizedParticipantId: string | null;
  readonly onSelect: (participantId: string | null) => void;
}) {
  const travelers =
    scene.routeLines.length > 0
      ? scene.legend.filter((entry) =>
          scene.routeLines.some((segment) => segment.participantId === entry.participantId),
        )
      : [];
  if (travelers.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1" data-testid="route-legend">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-700">Routes</p>
      <ul className="flex flex-wrap gap-2">
        {travelers.map((traveler) => {
          const active =
            !emphasizedParticipantId || emphasizedParticipantId === traveler.participantId;
          return (
            <li key={traveler.participantId}>
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-ink-700/10 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                style={{ opacity: active ? 1 : 0.45 }}
                aria-pressed={emphasizedParticipantId === traveler.participantId}
                onClick={() =>
                  onSelect(
                    emphasizedParticipantId === traveler.participantId
                      ? null
                      : traveler.participantId,
                  )
                }
              >
                <span
                  className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: traveler.color }}
                  aria-hidden
                >
                  {traveler.letter}
                </span>
                <span>
                  {traveler.letter} · {traveler.displayName}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function renderPanelBody({
  state,
  retry,
  rankingMode,
  setRankingMode,
  selectedKey,
  setSelectedKey,
  scene,
  emphasizedParticipantId,
  setEmphasizedParticipantId,
}: {
  state: SearchPageViewState;
  retry: () => void;
  rankingMode: RankingMode;
  setRankingMode: (mode: RankingMode) => void;
  selectedKey: string | null;
  setSelectedKey: (key: string) => void;
  scene: MapScene;
  emphasizedParticipantId: string | null;
  setEmphasizedParticipantId: (id: string | null) => void;
}) {
  switch (state.kind) {
    case 'malformed_id':
      return (
        <Alert variant="destructive">
          <AlertTitle>Invalid search link</AlertTitle>
          <AlertDescription>The search ID in this URL is not a valid identifier.</AlertDescription>
        </Alert>
      );
    case 'loading':
      return (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      );
    case 'not_found':
      return (
        <div className="space-y-3 text-ink-700">
          <h2 className="text-base font-semibold text-ink-950">Search not found.</h2>
          <p className="text-sm">This search may no longer exist, or the link may be incorrect.</p>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-medium text-teal-800 underline-offset-4 hover:underline"
            href="/search"
          >
            Start a new search
          </Link>
        </div>
      );
    case 'network_error':
      return (
        <div className="space-y-3">
          {state.summary ? (
            <p className="text-sm text-ink-700">
              Last known status: <strong>{state.summary.status}</strong>
            </p>
          ) : null}
          <Alert variant="warning">
            <AlertTitle>We lost connection while checking the search.</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
          <Button type="button" onClick={retry}>
            Retry
          </Button>
        </div>
      );
    case 'queued':
    case 'running':
    case 'partially_completed':
    case 'cancelling': {
      const travelerCount = state.summary.participants.length;
      const body =
        state.kind === 'queued'
          ? 'Your search is waiting to begin.'
          : state.kind === 'cancelling'
            ? 'Cancellation was requested. RailMeet is finishing cleanup before this search stops.'
            : state.kind === 'partially_completed'
              ? `Some journey comparisons are available, but RailMeet is still working for ${travelerCount} travelers.`
              : `Comparing journeys for ${travelerCount} travelers…`;
      return (
        <div className="space-y-3" aria-live="polite">
          <SearchSummaryCompact summary={state.summary} />
          <p className="text-sm text-ink-700">{body}</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-700">
            <li className={state.kind === 'queued' ? 'font-medium text-ink-950' : undefined}>
              Accepted
            </li>
            <li
              className={
                state.kind === 'running' ||
                state.kind === 'partially_completed' ||
                state.kind === 'cancelling'
                  ? 'font-medium text-ink-950'
                  : undefined
              }
            >
              Comparing journeys
            </li>
            <li>Show ranked meeting cities</li>
          </ol>
        </div>
      );
    }
    case 'failed':
      return (
        <div className="space-y-3 text-ink-700">
          <h2 className="text-base font-semibold text-ink-950">
            We couldn’t complete this search.
          </h2>
          <p className="text-sm">{failureMessage(state.summary.failureCode)}</p>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-medium text-teal-800 underline-offset-4 hover:underline"
            href="/search"
          >
            Start a new search
          </Link>
        </div>
      );
    case 'cancelled':
      return (
        <div className="space-y-3 text-ink-700">
          <h2 className="text-base font-semibold text-ink-950">This search was cancelled.</h2>
          <p className="text-sm">No ranked meeting plan is available for a cancelled search.</p>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-medium text-teal-800 underline-offset-4 hover:underline"
            href="/search"
          >
            Start a new search
          </Link>
        </div>
      );
    case 'completed':
      if (state.resultsLoading || !state.results) {
        return (
          <div className="space-y-3" aria-busy="true" aria-live="polite">
            <SearchSummaryCompact summary={state.summary} />
            <p className="text-sm text-ink-700">Loading ranked results…</p>
            <Skeleton className="h-28 w-full" />
          </div>
        );
      }
      return (
        <div className="space-y-4">
          <SearchSummaryCompact summary={state.summary} />
          <RouteLegend
            scene={scene}
            emphasizedParticipantId={emphasizedParticipantId}
            onSelect={setEmphasizedParticipantId}
          />
          <SearchResultsView
            results={state.results}
            rankingMode={rankingMode}
            onRankingModeChange={setRankingMode}
            selectedKey={selectedKey}
            onSelectCandidate={setSelectedKey}
            emphasizedParticipantId={emphasizedParticipantId}
            onEmphasizeParticipant={setEmphasizedParticipantId}
            missingGeometry={scene.missingGeometry}
          />
        </div>
      );
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function SearchSummaryCompact({ summary }: { readonly summary: MeetingSearchDetailData }) {
  return (
    <div className="rounded-xl border border-ink-700/10 bg-mist-50 px-3 py-2 text-xs text-ink-700">
      <p className="font-medium text-ink-950">
        {summary.participants.length} travelers · {summary.travelDate} · {summary.rankingMode}
      </p>
      <p className="mt-1 flex flex-wrap gap-2">
        {summary.participants.map((participant, index) => (
          <span key={participant.id} className="inline-flex items-center gap-1">
            <span
              className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
              style={{ backgroundColor: travelerColorAt(index) }}
              aria-hidden
            >
              {travelerLetterAt(index)}
            </span>
            {participant.displayName}
          </span>
        ))}
      </p>
    </div>
  );
}
