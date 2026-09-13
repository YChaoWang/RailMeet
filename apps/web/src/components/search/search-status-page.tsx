'use client';

import { ArrowLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { motisPlanModeLabel, type RankingMode } from '@railmeet/shared';
import type { MeetingSearchDetailData } from '@railmeet/validation';

import { usePlannerMap } from '@/components/search/planner-map-context';
import {
  createInitialParticipants,
  SearchForm,
  type ParticipantDraft,
} from '@/components/search/search-form';
import { SearchResultsView } from '@/components/search/search-results-view';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ChatAssistant, ChatThread, ChatUser, ChatWaterfallItem } from '@/components/ui/chat';
import { ChainOfThought } from '@/components/ui/chain-of-thought';
import { PromptSuggestion } from '@/components/ui/prompt-suggestion';
import { Skeleton } from '@/components/ui/skeleton';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { useSearchPolling } from '@/hooks/use-search-polling';
import {
  buildDraftOriginScene,
  buildMapScene,
  candidateSelectionKey,
  type MapScene,
} from '@/lib/map-markers';
import {
  failureMessage,
  formatTravelDate,
  rankingsForMode,
  type SearchPageViewState,
} from '@/lib/search-view-model';
import { travelerLetterAt } from '@/lib/traveler-identity';

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
    setSheetExpanded,
    setHeaderAction,
    setCandidateSelectHandler,
    setTravelerSelectHandler,
  } = usePlannerMap();
  const { state, retry } = useSearchPolling(searchId);
  const [rankingMode, setRankingMode] = useState<RankingMode>('fairest');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [emphasizedParticipantId, setEmphasizedParticipantId] = useState<string | null>(null);
  const [newSearchOpen, setNewSearchOpen] = useState(false);
  const [draftParticipants, setDraftParticipants] =
    useState<ParticipantDraft[]>(createInitialParticipants);

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

  const draftScene = useMemo(() => buildDraftOriginScene(draftParticipants), [draftParticipants]);
  const activeScene = newSearchOpen && draftScene.markers.length > 0 ? draftScene : scene;

  useEffect(() => {
    setPanelTitle(newSearchOpen ? 'Plan a meeting point' : panelTitleFor(state.kind));
  }, [newSearchOpen, state.kind, setPanelTitle]);

  useEffect(() => {
    // Keep draft traveler markers on the persistent map until the first search summary arrives.
    if (
      (state.kind === 'loading' || state.kind === 'not_found') &&
      activeScene.markers.length === 0 &&
      activeScene.routeLines.length === 0
    ) {
      return;
    }
    setScene(activeScene);
  }, [activeScene, setScene, state.kind]);

  useEffect(() => {
    if (newSearchOpen) {
      setSheetExpanded(true);
    }
  }, [newSearchOpen, setSheetExpanded]);

  useEffect(() => {
    if (results?.searchId) {
      setSheetExpanded(true);
    }
  }, [results?.searchId, setSheetExpanded]);

  useEffect(() => {
    const headerButtonClassName =
      'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-950 hover:bg-ink-950/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950';
    setHeaderAction(
      newSearchOpen ? (
        <button
          type="button"
          className={headerButtonClassName}
          data-testid="back-to-result"
          onClick={() => setNewSearchOpen(false)}
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden />
          Back to result
        </button>
      ) : (
        <button
          type="button"
          className={headerButtonClassName}
          data-testid="new-search-toggle"
          onClick={() => setNewSearchOpen(true)}
        >
          <Search className="size-4 shrink-0" aria-hidden />
          New Search
        </button>
      ),
    );
    return () => setHeaderAction(null);
  }, [newSearchOpen, setHeaderAction]);

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

  if (newSearchOpen) {
    return (
      <section className="min-w-0" aria-label="New search" data-testid="inline-new-search">
        <ChatThread>
          <ChatAssistant>
            <ChatWaterfallItem index={0}>
              <p className="text-sm text-ink-950">I’ll start a new search.</p>
            </ChatWaterfallItem>
            <ChatWaterfallItem index={1}>
              <p className="text-sm text-ink-700">
                Choose each traveler’s starting place. Your last results stay on the map until you
                search again.
              </p>
            </ChatWaterfallItem>
          </ChatAssistant>
          <SearchForm
            participants={draftParticipants}
            onParticipantsChange={setDraftParticipants}
            waterfallStart={2}
          />
        </ChatThread>
      </section>
    );
  }

  return renderPanelBody({
    state,
    retry,
    rankingMode,
    setRankingMode,
    selectedKey,
    setSelectedKey,
    scene,
    emphasizedParticipantId,
    setEmphasizedParticipantId,
    onNewSearch: () => setNewSearchOpen(true),
  });
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
    <div
      className="min-w-0 space-y-1 max-md:max-h-44 max-md:overflow-y-auto max-md:overflow-x-hidden"
      data-testid="route-legend"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-700">Routes</p>
        {emphasizedParticipantId ? (
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center rounded px-2 text-xs font-medium text-ink-950 underline underline-offset-2 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950"
            data-testid="route-legend-clear-emphasis"
            onClick={() => onSelect(null)}
          >
            Show all routes
          </button>
        ) : null}
      </div>
      <ul className="flex min-w-0 flex-col gap-2">
        {travelers.map((traveler) => {
          const active =
            !emphasizedParticipantId || emphasizedParticipantId === traveler.participantId;
          return (
            <li key={traveler.participantId} className="min-w-0">
              <button
                type="button"
                className="inline-flex min-h-11 w-full max-w-full items-start gap-2 rounded-lg border border-ink-700/10 px-2 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950 md:w-auto md:items-center"
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
                  className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white md:mt-0"
                  style={{ backgroundColor: traveler.color }}
                  aria-hidden
                >
                  {traveler.letter}
                </span>
                <span className="min-w-0 break-words">
                  {traveler.letter} · {traveler.displayName}
                </span>
                {traveler.services.length > 0 ? (
                  <span
                    className="flex min-w-0 flex-wrap items-center gap-1"
                    data-testid="route-services"
                  >
                    {traveler.services.map((service) => (
                      <span
                        key={`${service.mode}:${service.displayName}:${service.color}`}
                        className="max-w-full truncate rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          backgroundColor: service.color,
                          color: service.textColor,
                          // Provider-published colors are solid; mode fallbacks are outlined
                          // so an unofficial color is never mistaken for the operator's.
                          border:
                            service.colorSource === 'provider'
                              ? '1px solid transparent'
                              : '1px dashed rgba(15,23,42,0.55)',
                        }}
                        title={
                          service.colorSource === 'provider'
                            ? `${motisPlanModeLabel(service.mode)} · ${service.displayName}`
                            : `${motisPlanModeLabel(service.mode)} · ${service.displayName} (mode fallback)`
                        }
                        data-color-source={service.colorSource}
                      >
                        {service.displayName}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function searchProgressIntro(
  kind: 'queued' | 'running' | 'partially_completed' | 'cancelling',
  travelerCount: number,
): string {
  switch (kind) {
    case 'queued':
      return 'I’ve accepted this search. I’ll start comparing journeys as soon as routing begins.';
    case 'cancelling':
      return 'I’m stopping this search.';
    case 'partially_completed':
      return `Some routes are in. I’m still comparing journeys for ${travelerCount} travelers.`;
    default:
      return `I’m determining routes for ${travelerCount} travelers.`;
  }
}

function searchProgressTrigger(
  kind: 'queued' | 'running' | 'partially_completed' | 'cancelling',
): string {
  switch (kind) {
    case 'queued':
      return 'Preparing the search';
    case 'cancelling':
      return 'Stopping the search';
    case 'partially_completed':
      return 'Still refining routes';
    default:
      return 'Determining routes';
  }
}

const REVEAL_STEP_MS = 520;
const REVEAL_ITEM_MS = 260;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function SearchRouteProgress({
  kind,
  summary,
}: {
  readonly kind: 'queued' | 'running' | 'partially_completed' | 'cancelling';
  readonly summary: MeetingSearchDetailData;
}) {
  const travelerCount = summary.participants.length;
  const targetStep = kind === 'queued' ? 1 : 3;
  const targetTravelers = kind === 'queued' ? 0 : travelerCount;
  const [visibleStep, setVisibleStep] = useState(0);
  const [visibleTravelers, setVisibleTravelers] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setVisibleStep(targetStep);
      setVisibleTravelers(targetTravelers);
      return;
    }

    if (visibleStep < targetStep) {
      if (visibleStep === 2 && visibleTravelers < targetTravelers) {
        const itemTimer = window.setTimeout(() => {
          setVisibleTravelers((count) => count + 1);
        }, REVEAL_ITEM_MS);
        return () => window.clearTimeout(itemTimer);
      }
      const stepTimer = window.setTimeout(() => {
        setVisibleStep((step) => step + 1);
      }, REVEAL_STEP_MS);
      return () => window.clearTimeout(stepTimer);
    }

    if (visibleTravelers < targetTravelers) {
      const itemTimer = window.setTimeout(() => {
        setVisibleTravelers((count) => count + 1);
      }, REVEAL_ITEM_MS);
      return () => window.clearTimeout(itemTimer);
    }
    return undefined;
  }, [targetStep, targetTravelers, visibleStep, visibleTravelers]);

  const compareStatus = kind === 'queued' ? 'pending' : 'active';
  const acceptedBody =
    kind === 'queued'
      ? 'Your search is waiting to begin.'
      : 'The search was accepted and handed to routing.';
  const compareBody =
    kind === 'queued'
      ? 'Journey comparisons start after the search leaves the queue.'
      : kind === 'cancelling'
        ? 'Cancellation was requested. RailMeet is finishing cleanup before this search stops.'
        : kind === 'partially_completed'
          ? `Some journey comparisons are available, but RailMeet is still working for ${travelerCount} travelers.`
          : `Comparing journeys for ${travelerCount} travelers…`;

  return (
    <ChainOfThought
      defaultExpanded
      isStreaming
      data-testid="search-route-progress"
      aria-label="Route search progress"
    >
      <ChainOfThought.Trigger>{searchProgressTrigger(kind)}</ChainOfThought.Trigger>
      <ChainOfThought.Content>
        <ChainOfThought.Steps>
          {visibleStep >= 1 ? (
            <ChainOfThought.Step label="Accepted" status="complete">
              {acceptedBody}
            </ChainOfThought.Step>
          ) : null}
          {visibleStep >= 2 ? (
            <ChainOfThought.Step label="Determine routes" status={compareStatus}>
              <p>{compareBody}</p>
              {visibleTravelers > 0 ? (
                <ul className="mt-2 space-y-1">
                  {summary.participants.slice(0, visibleTravelers).map((participant, index) => {
                    const loading =
                      index === visibleTravelers - 1 && visibleTravelers < targetTravelers;
                    const line = (
                      <>
                        Determine route for {participant.displayName}
                        {participant.origin.name ? ` from ${participant.origin.name}` : ''}
                      </>
                    );
                    return (
                      <li
                        key={participant.id}
                        className="min-w-0 break-words motion-safe:animate-cot-in"
                        data-testid="search-progress-traveler"
                      >
                        {loading ? (
                          <ChainOfThought.StreamingText>{line}</ChainOfThought.StreamingText>
                        ) : (
                          line
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </ChainOfThought.Step>
          ) : null}
          {visibleStep >= 3 ? (
            <ChainOfThought.Step label="Show ranked meeting cities" status="pending">
              Ranked cities appear when every traveler’s routes are ready.
            </ChainOfThought.Step>
          ) : null}
        </ChainOfThought.Steps>
      </ChainOfThought.Content>
    </ChainOfThought>
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
  onNewSearch,
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
  onNewSearch: () => void;
}) {
  switch (state.kind) {
    case 'malformed_id':
      return (
        <ChatThread>
          <ChatAssistant>
            <Alert variant="destructive">
              <AlertTitle>Invalid search link</AlertTitle>
              <AlertDescription>
                The search ID in this URL is not a valid identifier.
              </AlertDescription>
            </Alert>
          </ChatAssistant>
        </ChatThread>
      );
    case 'loading':
      return (
        <ChatThread aria-busy="true" aria-live="polite">
          <ChatAssistant>
            <TextShimmer className="text-sm text-muted">Loading search…</TextShimmer>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </ChatAssistant>
        </ChatThread>
      );
    case 'not_found':
      return (
        <AssistantReply
          title="Search not found."
          body="This search may no longer exist, or the link may be incorrect."
        />
      );
    case 'network_error':
      return (
        <ChatThread>
          {state.summary ? (
            <ChatUser>
              <SearchSummaryCompact summary={state.summary} />
            </ChatUser>
          ) : null}
          <ChatAssistant>
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
          </ChatAssistant>
        </ChatThread>
      );
    case 'queued':
    case 'running':
    case 'partially_completed':
    case 'cancelling':
      return (
        <ChatThread aria-live="polite">
          <ChatUser>
            <SearchSummaryCompact summary={state.summary} />
          </ChatUser>
          <ChatAssistant>
            <p className="text-sm text-ink-950">
              {searchProgressIntro(state.kind, state.summary.participants.length)}
            </p>
            <SearchRouteProgress
              key={state.summary.searchId}
              kind={state.kind}
              summary={state.summary}
            />
          </ChatAssistant>
        </ChatThread>
      );
    case 'failed':
      return (
        <AssistantReply
          title="We couldn’t complete this search."
          body={failureMessage(state.summary.failureCode)}
        />
      );
    case 'cancelled':
      return (
        <AssistantReply
          title="This search was cancelled."
          body="No ranked meeting plan is available for a cancelled search."
        />
      );
    case 'completed':
      if (state.resultsLoading || !state.results) {
        return (
          <ChatThread aria-busy="true" aria-live="polite">
            <ChatUser>
              <SearchSummaryCompact summary={state.summary} />
            </ChatUser>
            <ChatAssistant>
              <TextShimmer className="text-sm text-muted">Loading ranked results…</TextShimmer>
              <Skeleton className="h-28 w-full" />
            </ChatAssistant>
          </ChatThread>
        );
      }
      return (
        <div className="min-w-0 xl:h-full" data-testid="search-completed-panel">
          <SearchResultsView
            results={state.results}
            rankingMode={rankingMode}
            onRankingModeChange={setRankingMode}
            selectedKey={selectedKey}
            onSelectCandidate={setSelectedKey}
            emphasizedParticipantId={emphasizedParticipantId}
            onEmphasizeParticipant={setEmphasizedParticipantId}
            missingGeometry={scene.missingGeometry}
            embedded
            listHeader={<SearchSummaryCompact summary={state.summary} />}
            listFooter={
              <RouteLegend
                scene={scene}
                emphasizedParticipantId={emphasizedParticipantId}
                onSelect={setEmphasizedParticipantId}
              />
            }
            onNewSearch={onNewSearch}
          />
        </div>
      );
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function AssistantReply({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <ChatThread>
      <ChatAssistant>
        <ChatWaterfallItem index={0}>
          <h2 className="text-base font-semibold text-ink-950">{title}</h2>
        </ChatWaterfallItem>
        <ChatWaterfallItem index={1}>
          <p className="text-sm text-ink-700">{body}</p>
        </ChatWaterfallItem>
        <PromptSuggestion>
          <ChatWaterfallItem index={2}>
            <PromptSuggestion.Header>
              <PromptSuggestion.Title>What can I help with?</PromptSuggestion.Title>
              <PromptSuggestion.Description>
                Start from a suggested prompt.
              </PromptSuggestion.Description>
            </PromptSuggestion.Header>
          </ChatWaterfallItem>
          <PromptSuggestion.Items>
            <ChatWaterfallItem index={3}>
              <PromptSuggestion.ItemLink href="/search">
                <PromptSuggestion.ItemTitle>Start a new search</PromptSuggestion.ItemTitle>
                <PromptSuggestion.ItemDescription>
                  Try different origins, times, or modes.
                </PromptSuggestion.ItemDescription>
              </PromptSuggestion.ItemLink>
            </ChatWaterfallItem>
          </PromptSuggestion.Items>
        </PromptSuggestion>
      </ChatAssistant>
    </ChatThread>
  );
}

function SearchSummaryCompact({ summary }: { readonly summary: MeetingSearchDetailData }) {
  return (
    <div
      className="max-w-[min(100%,17.5rem)] min-w-0 break-words rounded-2xl rounded-br-md bg-ink-950 px-3 py-2 text-xs text-white"
      data-testid="search-summary-compact"
    >
      <p className="font-medium text-white">
        {formatTravelDate(summary.travelDate)} · {summary.participants.length} travelers
      </p>
      <p className="mt-1 flex flex-wrap gap-2 text-white/80">
        {summary.participants.map((participant, index) => (
          <span
            key={participant.id}
            className="inline-flex min-w-0 max-w-full items-center gap-1 break-words"
          >
            <span
              className="grid h-4 w-4 place-items-center rounded-full bg-white/20 text-[9px] font-bold text-white"
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
