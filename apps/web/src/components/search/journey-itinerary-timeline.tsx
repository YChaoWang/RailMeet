'use client';

import {
  Accessibility,
  AlertTriangle,
  Bike,
  Bus,
  CableCar,
  Car,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Footprints,
  Plane,
  Ship,
  TrainFront,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import {
  buildStopTimePresentation,
  buildTimelineItems,
  continuesAsStops,
  expandableIntermediateStops,
  formatDelayLabel,
  httpUrl,
  journeyOverviewHeader,
  ticketUrl,
  type JourneyItineraryContext,
  type TimelineItem,
  type TransferBreakdown,
} from '@/lib/journey-itinerary-presentation';
import {
  directionLine,
  formatMotisClock,
  formatMotisDistance,
  formatMotisDuration,
  motisChipColors,
  motisIconKind,
  motisOperatorLabel,
  motisServiceLabel,
  rankingLegToMotis,
  stopCountLabel,
  type RankingLeg,
} from '@/lib/journey-leg-presentation';
import { cn } from '@/lib/utils';
import type { MotisItineraryJson, MotisLegJson, MotisModeIconKind, MotisPlaceJson } from '@railmeet/shared';

const MODE_ICONS: Record<MotisModeIconKind, typeof TrainFront> = {
  walk: Footprints,
  bike: Footprints,
  cargo_bike: Footprints,
  car: Car,
  moped: Car,
  scooter: Footprints,
  seated_scooter: Footprints,
  taxi: Car,
  bus: Bus,
  tram: CableCar,
  train: TrainFront,
  metro: TrainFront,
  ship: Ship,
  plane: Plane,
  funicular: CableCar,
  aerial_lift: CableCar,
  other: CircleHelp,
};

function ModeIcon({ kind, className }: { readonly kind: MotisModeIconKind; readonly className?: string }) {
  const Icon = MODE_ICONS[kind];
  return <Icon className={className} aria-hidden />;
}

function RoutePill({ leg }: { readonly leg: MotisLegJson }) {
  const colors = motisChipColors(leg);
  const iconKind = motisIconKind(leg);
  const label = motisServiceLabel(leg);
  const routeUrl = httpUrl(leg.routeUrl);
  const content = (
    <>
      <ModeIcon kind={iconKind} className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold leading-none"
      style={{ backgroundColor: colors.background, color: colors.color }}
      data-testid="route-pill"
    >
      {routeUrl ? (
        <a href={routeUrl} className="inline-flex min-h-9 items-center gap-1 underline-offset-2 hover:underline">
          {content}
          <ExternalLink className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
          <span className="sr-only">Route information for {label}</span>
        </a>
      ) : (
        content
      )}
    </span>
  );
}

function PlatformBadge({ label }: { readonly label: string }) {
  return (
    <span
      className="shrink-0 rounded bg-mist-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-700"
      data-testid="leg-platform"
    >
      {label}
    </span>
  );
}

function StopRow({
  presentation,
  emphasize,
}: {
  readonly presentation: NonNullable<ReturnType<typeof buildStopTimePresentation>>;
  readonly emphasize: boolean;
}) {
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
      <div className="tabular-nums">
        <span
          className={cn('text-sm', emphasize ? 'font-semibold text-ink-950' : 'text-ink-900')}
          data-testid="leg-time-live"
        >
          {presentation.live}
        </span>
        {presentation.dayOffsetLabel ? (
          <span className="ml-1 text-[10px] font-medium text-ink-700" data-testid="leg-day-offset">
            {presentation.dayOffsetLabel}
          </span>
        ) : null}
        {presentation.showScheduledStrike && presentation.scheduled ? (
          <span
            className="block text-[10px] text-ink-700 line-through"
            data-testid="leg-time-scheduled"
          >
            {presentation.scheduled}
          </span>
        ) : null}
        {!presentation.showScheduledStrike && presentation.scheduled ? (
          <span className="block text-[10px] text-ink-700" data-testid="leg-time-scheduled">
            {presentation.scheduled} scheduled
          </span>
        ) : null}
        {presentation.delayMinutes !== null && presentation.delayMinutes !== 0 ? (
          <span className="block text-[10px] text-amber-800" data-testid="leg-delay">
            {formatDelayLabel(presentation.delayMinutes)}
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <span
            className={cn('min-w-0 text-sm', emphasize ? 'font-semibold text-ink-950' : 'text-ink-900')}
            data-testid="leg-stop-name"
          >
            {presentation.stopName}
          </span>
          {presentation.platform ? <PlatformBadge label={presentation.platform} /> : null}
        </div>
        {presentation.continuesAs ? (
          <p className="mt-0.5 text-xs text-teal-800" data-testid="leg-continues-as">
            Continues as {presentation.continuesAs}
            <span className="sr-only">. Stay on board, no transfer required.</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DateSeparator({ label }: { readonly label: string }) {
  return (
    <div
      className="relative py-2"
      role="separator"
      aria-label={label}
      data-testid="journey-date-separator"
    >
      <div className="absolute inset-x-0 top-1/2 border-t border-ink-700/15" />
      <p className="relative mx-auto w-fit bg-white px-2 text-[11px] font-medium uppercase tracking-wide text-ink-700">
        {label}
      </p>
    </div>
  );
}

function TransferBlock({
  breakdown,
  walkLeg,
}: {
  readonly breakdown: TransferBreakdown;
  readonly walkLeg: MotisLegJson | null;
}) {
  return (
    <div
      className="rounded-lg border border-ink-700/10 bg-mist-50/80 px-3 py-2 text-xs text-ink-800"
      data-testid="journey-transfer"
    >
      <p className="font-medium text-ink-950">
        {formatMotisDuration(breakdown.connectionSeconds)} connection
      </p>
      {walkLeg && breakdown.walkSeconds !== null ? (
        <p className="mt-0.5">
          {formatMotisDuration(breakdown.walkSeconds)} walk
          {typeof walkLeg.distance === 'number' ? ` · ${formatMotisDistance(walkLeg.distance)}` : ''}
        </p>
      ) : null}
      {breakdown.fromPlatform || breakdown.toPlatform ? (
        <p className="mt-0.5 text-ink-700">
          {[breakdown.fromPlatform, breakdown.toPlatform].filter(Boolean).join(' → ')}
        </p>
      ) : null}
      {breakdown.waitingSeconds !== null && breakdown.waitingSeconds > 0 ? (
        <p className="mt-0.5 text-ink-700">{formatMotisDuration(breakdown.waitingSeconds)} remaining</p>
      ) : null}
      {breakdown.stationChange ? (
        <p className="mt-1 font-medium text-amber-900" data-testid="journey-station-change">
          Change station
          <span className="mt-0.5 block font-normal">
            {breakdown.fromStop} → {breakdown.toStop}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function WalkBlock({ leg, role }: { readonly leg: MotisLegJson; readonly role: string }) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const stepsId = useId();
  const distance = typeof leg.distance === 'number' ? formatMotisDistance(leg.distance) : null;
  const steps = (leg.steps ?? []).filter((step) => (step.streetName ?? '').trim().length > 0);

  return (
    <div
      className="flex gap-2 py-1 text-xs text-ink-700"
      data-testid="journey-walk"
      data-walk-role={role}
    >
      <div className="flex w-3 shrink-0 justify-center">
        <div className="w-px border-l border-dashed border-ink-700/30" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="inline-flex items-center gap-1 font-medium text-ink-900">
          <Footprints className="h-3.5 w-3.5" aria-hidden />
          Walk {formatMotisDuration(leg.duration)}
          {distance ? ` · ${distance}` : ''}
        </p>
        {steps.length > 0 ? (
          <>
            <button
              type="button"
              className="mt-1 min-h-9 text-left text-[11px] font-medium text-teal-800 underline-offset-2 hover:underline"
              aria-expanded={stepsOpen}
              aria-controls={stepsId}
              onClick={() => setStepsOpen((open) => !open)}
            >
              {stepsOpen ? 'Hide walking directions' : 'Show walking directions'}
            </button>
            {stepsOpen ? (
              <p id={stepsId} className="mt-1 text-[11px] text-ink-700" data-testid="journey-leg-steps">
                Via {steps.map((step) => step.streetName).join(', ')}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function LegMetaBadges({ leg }: { readonly leg: MotisLegJson }) {
  const badges: ReactNode[] = [];
  if (leg.cancelled) {
    badges.push(
      <span key="cancelled" className="inline-flex items-center gap-1 font-medium text-red-800" data-testid="leg-cancelled">
        <CircleHelp className="h-3 w-3" aria-hidden />
        Cancelled
      </span>,
    );
  }
  if (leg.reservation === 'COMPULSORY') {
    badges.push(
      <span key="reservation" data-testid="leg-reservation">
        Reservation required
      </span>,
    );
  }
  if (leg.bikesAllowed) {
    badges.push(
      <span key="bikes" className="inline-flex items-center gap-0.5" data-testid="leg-bikes">
        <Bike className="h-3 w-3" aria-hidden /> Bikes allowed
      </span>,
    );
  }
  if (leg.wheelchairAccessible === 'ACCESSIBLE') {
    badges.push(
      <span key="wheelchair" className="inline-flex items-center gap-0.5" data-testid="leg-wheelchair">
        <Accessibility className="h-3 w-3" aria-hidden /> Step-free
      </span>,
    );
  }
  if (badges.length === 0) {
    return null;
  }
  return <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-ink-700">{badges}</div>;
}

function LegAlerts({ leg }: { readonly leg: MotisLegJson }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const alerts = leg.alerts ?? [];
  if (alerts.length === 0) {
    return null;
  }
  const primary = alerts[0];
  const header = typeof primary?.headerText === 'string' ? primary.headerText : 'Service alert';
  return (
    <div className="mt-1 text-[11px]" data-testid="journey-leg-alerts">
      <button
        type="button"
        className="inline-flex min-h-9 items-start gap-1 text-left text-amber-900"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>{header}</span>
        <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <ul id={panelId} className="mt-1 space-y-1 pl-4 text-ink-800">
          {alerts.map((alert, index) => (
            <li key={`${alert.headerText ?? 'alert'}-${index}`}>
              {typeof alert.descriptionText === 'string' ? alert.descriptionText : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LegLinks({ leg }: { readonly leg: MotisLegJson }) {
  const tickets = httpUrl(ticketUrl(leg));
  const agencyUrl = httpUrl(leg.agencyUrl);
  const operator = motisOperatorLabel(leg);
  if (!tickets && !(agencyUrl && operator)) {
    return null;
  }
  return (
    <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
      {tickets ? (
        <a
          href={tickets}
          className="inline-flex min-h-9 items-center gap-1 font-medium text-teal-800 underline-offset-2 hover:underline"
          data-testid="leg-tickets"
        >
          Tickets
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
      {agencyUrl && operator ? (
        <a
          href={agencyUrl}
          className="inline-flex min-h-9 items-center gap-1 text-ink-700 underline-offset-2 hover:underline"
        >
          {operator}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

function LegAlternatives({ leg }: { readonly leg: MotisLegJson }) {
  const alternatives = leg.alternatives ?? [];
  if (alternatives.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2 space-y-1 text-[11px] text-ink-700" data-testid="journey-leg-alternatives">
      <li className="font-medium text-ink-900">Alternative departures (informational)</li>
      {alternatives.slice(0, 3).map((alt, index) => {
        const primary = alt.find((entry) => entry.displayName) ?? alt[0];
        if (!primary) {
          return null;
        }
        const fromTz = primary.from?.tz as string | undefined;
        const label = motisServiceLabel(primary);
        return (
          <li key={`${primary.startTime}-${index}`} className="rounded border border-ink-700/10 px-2 py-1">
            <span className="font-medium">{label}</span>
            {' · '}
            {formatMotisClock(primary.startTime, fromTz)} – {formatMotisClock(primary.endTime, primary.to?.tz as string | undefined)}
            {primary.from?.name && primary.from.name !== leg.from?.name ? (
              <span className="block text-amber-800">Different departure stop</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function IntermediateStops({ leg, journeyStartIso }: { readonly leg: MotisLegJson; readonly journeyStartIso: string }) {
  const expandable = expandableIntermediateStops(leg);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (expandable.length === 0) {
    return (
      <p className="py-1 pl-[3.75rem] text-[11px] text-ink-700 sm:pl-16">
        {stopCountLabel(0)} · {formatMotisDuration(leg.duration)}
      </p>
    );
  }

  let previousTs: string | null = leg.startTime;
  let previousTz = leg.from?.tz as string | undefined;

  return (
    <div className="py-1 pl-[3.75rem] sm:pl-16">
      <button
        type="button"
        className="inline-flex min-h-9 items-center gap-1 text-left text-[11px] font-medium text-teal-800 underline-offset-2 hover:underline"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {stopCountLabel(expandable.length)} · {formatMotisDuration(leg.duration)}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <ul id={panelId} className="mt-1 space-y-1" data-testid="journey-leg-stops">
          {expandable.map((stop, index) => {
            const presentation = buildStopTimePresentation({
              place: stop,
              timestamp: stop.arrival ?? stop.departure,
              scheduledTimestamp: stop.scheduledArrival ?? stop.scheduledDeparture,
              realTime: Boolean(leg.realTime),
              mode: leg.mode,
              journeyStartIso,
              previousTimestamp: previousTs,
              previousTimeZone: previousTz,
            });
            previousTs = stop.departure ?? stop.arrival ?? previousTs;
            previousTz = (stop.tz as string | undefined) ?? previousTz;
            if (!presentation) {
              return null;
            }
            return (
              <li key={`${stop.stopId ?? stop.name ?? 'stop'}-${index}`}>
                {presentation.dateSeparator ? <DateSeparator label={presentation.dateSeparator} /> : null}
                <StopRow presentation={presentation} emphasize={false} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function TransitSection({
  leg,
  journeyStartIso,
  isLastTransit,
}: {
  readonly leg: MotisLegJson;
  readonly journeyStartIso: string;
  readonly isLastTransit: boolean;
}) {
  const colors = motisChipColors(leg);
  const toward = directionLine(leg);
  const operator = motisOperatorLabel(leg);
  const continues = continuesAsStops(leg);

  const departure = buildStopTimePresentation({
    place: leg.from,
    timestamp: leg.startTime,
    scheduledTimestamp: leg.scheduledStartTime,
    realTime: Boolean(leg.realTime),
    mode: leg.mode,
    journeyStartIso,
    previousTimestamp: null,
    previousTimeZone: undefined,
  });
  const arrival = buildStopTimePresentation({
    place: leg.to,
    timestamp: leg.endTime,
    scheduledTimestamp: leg.scheduledEndTime,
    realTime: Boolean(leg.realTime),
    mode: leg.mode,
    journeyStartIso,
    previousTimestamp: leg.startTime,
    previousTimeZone: leg.from?.tz as string | undefined,
  });

  return (
    <article className="space-y-1" data-testid="journey-leg" data-motis-mode={leg.mode}>
      <div className="flex items-center gap-2">
        <RoutePill leg={leg} />
        <span className="sr-only" data-testid="journey-leg-mode">
          {motisServiceLabel(leg)}
        </span>
      </div>
      {toward ? (
        <p className="text-xs text-ink-700" data-testid="journey-leg-headsign">
          {toward}
        </p>
      ) : null}
      {operator ? (
        <p className="text-[11px] text-ink-700" data-testid="journey-leg-operator">
          {operator}
        </p>
      ) : null}

      <div className="relative pl-3">
        <div
          className="absolute bottom-2 left-[0.4rem] top-2 w-1 rounded-full"
          style={{ backgroundColor: colors.background }}
          aria-hidden
        />

        <div className="space-y-1 pb-1">
          {departure?.dateSeparator ? <DateSeparator label={departure.dateSeparator} /> : null}
          {departure ? <StopRow presentation={departure} emphasize /> : null}

          <IntermediateStops leg={leg} journeyStartIso={journeyStartIso} />

          {continues.map((stop, index) => {
            const presentation = buildStopTimePresentation({
              place: stop,
              timestamp: stop.arrival ?? stop.departure,
              scheduledTimestamp: stop.scheduledArrival ?? stop.scheduledDeparture,
              realTime: Boolean(leg.realTime),
              mode: leg.mode,
              journeyStartIso,
              previousTimestamp: leg.startTime,
              previousTimeZone: leg.from?.tz as string | undefined,
            });
            if (!presentation) {
              return null;
            }
            return (
              <div key={`continues-${index}`} className="py-0.5">
                <StopRow presentation={presentation} emphasize={false} />
              </div>
            );
          })}

          {!isLastTransit && arrival?.dateSeparator ? (
            <DateSeparator label={arrival.dateSeparator} />
          ) : null}
          {!isLastTransit && arrival ? <StopRow presentation={arrival} emphasize /> : null}
        </div>
      </div>

      <LegMetaBadges leg={leg} />
      <LegAlerts leg={leg} />
      <LegLinks leg={leg} />
      <LegAlternatives leg={leg} />
    </article>
  );
}

function JourneyOverview({
  itinerary,
  context,
}: {
  readonly itinerary: MotisItineraryJson;
  readonly context: JourneyItineraryContext;
}) {
  const overview = journeyOverviewHeader(itinerary, context);
  return (
    <header
      className="sticky top-0 z-[1] -mx-1 border-b border-ink-700/10 bg-white/95 px-1 pb-3 pt-1 backdrop-blur-sm"
      data-testid="journey-overview-header"
    >
      {overview.participantDisplayName ? (
        <p className="text-xs font-medium text-teal-800">{overview.participantDisplayName}&apos;s journey</p>
      ) : null}
      <p className="text-base font-semibold text-ink-950">
        {overview.origin} → {overview.destination}
      </p>
      <p className="text-xs text-ink-700">{overview.dateRange}</p>
      <p className="mt-1 text-sm tabular-nums text-ink-950">{overview.timeRange}</p>
      <p className="text-xs text-ink-700">
        {overview.durationLabel} · {overview.transfersLabel}
      </p>
      <div className="mt-2 flex flex-wrap gap-1" data-testid="journey-route-summary">
        {overview.routePills.map((pill, index) => (
          <span
            key={`${pill.label}-${index}`}
            className="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: pill.colors.background, color: pill.colors.color }}
          >
            {pill.label}
          </span>
        ))}
      </div>
    </header>
  );
}

function renderTimelineItem(
  item: TimelineItem,
  journeyStartIso: string,
): ReactNode {
  switch (item.kind) {
    case 'date-separator':
      return <DateSeparator key={`date-${item.label}`} label={item.label} />;
    case 'transfer':
      return (
        <TransferBlock
          key={`transfer-${item.breakdown.fromStop}-${item.breakdown.toStop}`}
          breakdown={item.breakdown}
          walkLeg={item.walkLeg}
        />
      );
    case 'walk':
      return <WalkBlock key={`walk-${item.leg.startTime}`} leg={item.leg} role={item.role} />;
    case 'transit':
      return (
        <TransitSection
          key={`transit-${item.leg.startTime}-${item.leg.displayName ?? item.leg.mode}`}
          leg={item.leg}
          journeyStartIso={journeyStartIso}
          isLastTransit={item.isLastTransit}
        />
      );
    default:
      return null;
  }
}

export function JourneyItineraryTimeline({
  itinerary,
  context = {},
}: {
  readonly itinerary: MotisItineraryJson;
  readonly context?: JourneyItineraryContext;
}) {
  const items = buildTimelineItems(itinerary);
  const legs = itinerary.legs;
  const lastLeg = legs[legs.length - 1];

  let lastArrival: ReturnType<typeof buildStopTimePresentation> = null;
  if (lastLeg) {
    lastArrival = buildStopTimePresentation({
      place: lastLeg.to,
      timestamp: lastLeg.endTime,
      scheduledTimestamp: lastLeg.scheduledEndTime,
      realTime: Boolean(lastLeg.realTime),
      mode: lastLeg.mode,
      journeyStartIso: itinerary.startTime,
      previousTimestamp: lastLeg.startTime,
      previousTimeZone: lastLeg.from?.tz as string | undefined,
    });
  }

  return (
    <div className="space-y-3 text-ink-800" data-testid="journey-itinerary">
      <JourneyOverview itinerary={itinerary} context={context} />
      <div className="space-y-3">{items.map((item) => renderTimelineItem(item, itinerary.startTime))}</div>
      {lastArrival ? (
        <div className="border-t border-ink-700/10 pt-2">
          {lastArrival.dateSeparator ? <DateSeparator label={lastArrival.dateSeparator} /> : null}
          <StopRow presentation={lastArrival} emphasize />
        </div>
      ) : null}
    </div>
  );
}

export function JourneyRouteSummary({
  segments,
}: {
  readonly segments: readonly {
    readonly mode: string;
    readonly displayName?: string | undefined;
    readonly routeColor?: string | undefined;
    readonly routeTextColor?: string | undefined;
  }[];
}) {
  if (segments.length === 0) {
    return null;
  }
  return (
    <p className="mt-2 flex flex-wrap gap-1" data-testid="journey-route-summary">
      {segments.map((segment, index) => {
        const colors = motisChipColors({
          mode: segment.mode,
          ...(segment.routeColor ? { routeColor: segment.routeColor } : {}),
          ...(segment.routeTextColor ? { routeTextColor: segment.routeTextColor } : {}),
        });
        const label = segment.displayName ?? segment.mode;
        return (
          <span
            key={`${segment.displayName ?? segment.mode}-${index}`}
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: colors.background, color: colors.color }}
          >
            {label}
          </span>
        );
      })}
    </p>
  );
}

/** Fallback when a search predates stored MOTIS itineraries (detailSource=legacy). */
export function RankingJourneyLegs({
  legs,
  context,
}: {
  readonly legs: readonly RankingLeg[];
  readonly context?: JourneyItineraryContext;
}) {
  const itinerary: MotisItineraryJson = {
    duration: legs.reduce((sum, leg) => sum + leg.durationMinutes * 60, 0),
    startTime: legs[0]?.departureAt ?? '',
    endTime: legs[legs.length - 1]?.arrivalAt ?? '',
    transfers: Math.max(0, legs.filter((leg) => rankingLegToMotis(leg).displayName).length - 1),
    legs: legs.map(rankingLegToMotis),
  };
  return (
    <div data-testid="ranking-journey-legs">
      <JourneyItineraryTimeline itinerary={itinerary} context={context ?? {}} />
    </div>
  );
}
