import {
  Accessibility,
  AlertTriangle,
  Bike,
  Bus,
  CableCar,
  Car,
  CircleHelp,
  Footprints,
  Plane,
  Ship,
  TrainFront,
} from 'lucide-react';
import { useState } from 'react';

import {
  isMotisTransitLeg,
  motisPlanModeLabel,
  type MotisItineraryJson,
  type MotisLegJson,
  type MotisModeIconKind,
  type MotisPlaceJson,
} from '@railmeet/shared';

import {
  directionLine,
  displayLegsFromItinerary,
  formatMotisClock,
  formatMotisDistance,
  formatMotisDuration,
  isWalkLike,
  motisChipColors,
  motisIconKind,
  motisOperatorLabel,
  motisServiceLabel,
  placeTitle,
  platformLabel,
  rankingLegToMotis,
  stopCountLabel,
  type RankingLeg,
} from '@/lib/journey-leg-presentation';

const ICONS: Record<MotisModeIconKind, typeof TrainFront> = {
  walk: Footprints,
  bike: Bike,
  cargo_bike: Bike,
  car: Car,
  moped: Car,
  scooter: Bike,
  seated_scooter: Bike,
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

function StopTime({
  place,
  timestamp,
  scheduledTimestamp,
  realTime,
  mode,
  emphasize,
}: {
  readonly place: MotisPlaceJson | undefined;
  readonly timestamp: string | undefined;
  readonly scheduledTimestamp: string | undefined;
  readonly realTime: boolean;
  readonly mode: string;
  readonly emphasize: boolean;
}) {
  const tz = typeof place?.tz === 'string' ? place.tz : undefined;
  const live = formatMotisClock(timestamp, tz);
  const scheduled = formatMotisClock(scheduledTimestamp, tz);
  const showScheduled = Boolean(scheduled && scheduled !== live);
  const platform = platformLabel(place, mode);
  const switchTo = place?.switchTo;
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      <span className={emphasize ? 'font-medium tabular-nums text-ink-900' : 'tabular-nums'}>
        <span data-testid="leg-time-live">{live}</span>
        {realTime && showScheduled ? (
          <span className="ml-1 text-[11px] text-ink-700 line-through" data-testid="leg-time-scheduled">
            {scheduled}
          </span>
        ) : null}
        {!realTime && showScheduled ? (
          <span className="ml-1 text-[11px] text-ink-700" data-testid="leg-time-scheduled">
            sched {scheduled}
          </span>
        ) : null}
      </span>
      <span>
        <span data-testid="leg-stop-name">{placeTitle(place, 'Stop')}</span>
        {platform ? (
          <span className="block text-[11px] text-ink-700" data-testid="leg-platform">
            {platform}
          </span>
        ) : null}
        {switchTo ? (
          <span className="mt-0.5 block text-[11px] text-ink-900" data-testid="leg-continues-as">
            Continues as {motisServiceLabel(switchTo)}
            {motisOperatorLabel(switchTo) ? ` · ${motisOperatorLabel(switchTo)}` : ''}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function TransitLeg({ leg }: { readonly leg: MotisLegJson }) {
  const [stopsOpen, setStopsOpen] = useState(false);
  const Icon = ICONS[motisIconKind(leg)];
  const colors = motisChipColors(leg);
  const modeLabel = motisPlanModeLabel(leg.mode);
  const operator = motisOperatorLabel(leg);
  const toward = directionLine(leg);
  const stops = leg.intermediateStops ?? [];
  const continuesAsStops = stops.filter((stop) => stop.switchTo);
  const expandableStops = stops.filter((stop) => !stop.switchTo);
  const alternatives = leg.alternatives ?? [];
  const alerts = leg.alerts ?? [];

  return (
    <li className="flex gap-2" data-testid="journey-leg" data-motis-mode={leg.mode}>
      <span
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-white"
        style={{ backgroundColor: colors.background, color: colors.color }}
        title={modeLabel}
        aria-label={modeLabel}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="inline-flex rounded px-1.5 py-0.5 text-xs font-semibold"
          style={{ backgroundColor: colors.background, color: colors.color }}
          data-testid="journey-leg-service"
        >
          {httpUrl(leg.routeUrl) ? (
            <a href={httpUrl(leg.routeUrl)} className="underline-offset-2 hover:underline">
              {motisServiceLabel(leg)}
            </a>
          ) : (
            motisServiceLabel(leg)
          )}
        </p>
        {operator ? (
          <p className="text-ink-700" data-testid="journey-leg-operator">
            {httpUrl(leg.agencyUrl) ? (
              <a href={httpUrl(leg.agencyUrl)} className="underline-offset-2 hover:underline">
                {operator}
              </a>
            ) : (
              operator
            )}
          </p>
        ) : null}
        {toward ? (
          <p className="text-ink-700" data-testid="journey-leg-headsign">
            {toward}
          </p>
        ) : null}
        <p className="sr-only" data-testid="journey-leg-mode">
          {modeLabel}
        </p>

        <div className="mt-1 space-y-1">
          <StopTime
            place={leg.from}
            timestamp={leg.startTime}
            scheduledTimestamp={leg.scheduledStartTime}
            realTime={Boolean(leg.realTime)}
            mode={leg.mode}
            emphasize
          />
          <p className="pl-[4.5rem] text-ink-700">
            {stopCountLabel(stops.length)} · {formatMotisDuration(leg.duration)}
          </p>
          {continuesAsStops.map((stop, index) => (
            <StopTime
              key={`continues-${stop.stopId ?? stop.name ?? index}`}
              place={stop}
              timestamp={stop.arrival ?? stop.departure}
              scheduledTimestamp={stop.scheduledArrival ?? stop.scheduledDeparture}
              realTime={Boolean(leg.realTime)}
              mode={leg.mode}
              emphasize={false}
            />
          ))}
          {expandableStops.length > 0 ? (
            <div>
              <button
                type="button"
                className="text-left text-[11px] font-medium text-teal-800 underline-offset-2 hover:underline"
                aria-expanded={stopsOpen}
                onClick={() => setStopsOpen((open) => !open)}
              >
                {stopsOpen ? 'Hide intermediate stops' : 'Show intermediate stops'}
              </button>
              {stopsOpen ? (
                <ul className="mt-1 space-y-1" data-testid="journey-leg-stops">
                  {expandableStops.map((stop, index) => (
                    <li key={`${stop.stopId ?? stop.name ?? 'stop'}-${index}`}>
                      <StopTime
                        place={stop}
                        timestamp={stop.arrival ?? stop.departure}
                        scheduledTimestamp={stop.scheduledArrival ?? stop.scheduledDeparture}
                        realTime={Boolean(leg.realTime)}
                        mode={leg.mode}
                        emphasize={false}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <StopTime
            place={leg.to}
            timestamp={leg.endTime}
            scheduledTimestamp={leg.scheduledEndTime}
            realTime={Boolean(leg.realTime)}
            mode={leg.mode}
            emphasize
          />
        </div>

        <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-ink-700">
          {leg.cancelled ? (
            <span data-testid="leg-cancelled">Cancelled</span>
          ) : null}
          {leg.reservation === 'COMPULSORY' ? (
            <span data-testid="leg-reservation">Reservation required</span>
          ) : null}
          {leg.bikesAllowed ? (
            <span className="inline-flex items-center gap-0.5" data-testid="leg-bikes">
              <Bike className="h-3 w-3" aria-hidden /> Bikes
            </span>
          ) : null}
          {leg.wheelchairAccessible === 'ACCESSIBLE' ? (
            <span className="inline-flex items-center gap-0.5" data-testid="leg-wheelchair">
              <Accessibility className="h-3 w-3" aria-hidden /> Step-free
            </span>
          ) : null}
        </div>

        {alerts.length > 0 ? (
          <ul className="mt-1 space-y-1" data-testid="journey-leg-alerts">
            {alerts.map((alert, index) => (
              <li key={`${alert.headerText ?? 'alert'}-${index}`} className="flex gap-1 text-amber-800">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span>
                  {typeof alert.headerText === 'string' ? alert.headerText : 'Service alert'}
                  {typeof alert.descriptionText === 'string' ? ` — ${alert.descriptionText}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {httpUrl(ticketUrl(leg)) ? (
          <p className="mt-1 text-[11px]">
            <a
              href={httpUrl(ticketUrl(leg))}
              className="font-medium text-teal-800 underline-offset-2 hover:underline"
              data-testid="leg-tickets"
            >
              Tickets
            </a>
          </p>
        ) : null}

        {alternatives.length > 0 ? (
          <ul className="mt-1 text-[11px] text-ink-700" data-testid="journey-leg-alternatives">
            {alternatives.slice(0, 3).map((alt, index) => {
              const transit = alt.find(isMotisTransitLeg);
              if (!transit) {
                return null;
              }
              return (
                <li key={`${transit.startTime}-${index}`}>
                  Alternative {motisServiceLabel(transit)} {formatMotisClock(transit.startTime, transit.from?.tz)}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function ticketUrl(leg: MotisLegJson): unknown {
  const tickets = leg.ticketUrls;
  if (!tickets || typeof tickets !== 'object') {
    return undefined;
  }
  return (tickets as { web?: unknown }).web;
}

function StreetLeg({ leg }: { readonly leg: MotisLegJson }) {
  const Icon = ICONS[motisIconKind(leg)];
  const modeLabel = motisPlanModeLabel(leg.mode);
  const distance = typeof leg.distance === 'number' ? formatMotisDistance(leg.distance) : undefined;
  const steps = (leg.steps ?? []).filter((step) => (step.streetName ?? '').trim().length > 0);
  const rentalName =
    typeof leg.rental?.systemName === 'string' ? leg.rental.systemName.trim() : '';

  return (
    <li
      className="flex gap-2"
      data-testid="journey-leg"
      data-motis-mode={leg.mode}
      data-has-geometry={leg.legGeometry?.points ? 'true' : 'false'}
    >
      <span
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-mist-100 text-ink-900"
        title={modeLabel}
        aria-label={modeLabel}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink-950" data-testid="journey-leg-service">
          {modeLabel}
        </p>
        <p className="sr-only" data-testid="journey-leg-mode">
          {modeLabel}
        </p>
        <p className="text-ink-700">
          {formatMotisDuration(leg.duration)}
          {distance ? ` · ${distance}` : ''}
          {rentalName ? ` · ${rentalName}` : ''}
        </p>
        {steps.length > 0 ? (
          <p className="text-[11px] text-ink-700" data-testid="journey-leg-steps">
            Via {steps.map((step) => step.streetName).join(', ')}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function JourneyItineraryDetails({
  itinerary,
}: {
  readonly itinerary: MotisItineraryJson;
}) {
  const legs = displayLegsFromItinerary(itinerary);
  return (
    <ul className="mt-1 space-y-2 text-xs text-ink-700" data-testid="journey-itinerary">
      {legs.map((leg, index) =>
        isWalkLike(leg) || !isMotisTransitLeg(leg) ? (
          <StreetLeg key={`${leg.mode}-${leg.startTime}-${index}`} leg={leg} />
        ) : (
          <TransitLeg key={`${leg.mode}-${leg.startTime}-${index}`} leg={leg} />
        ),
      )}
    </ul>
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
        const label = segment.displayName ?? motisPlanModeLabel(segment.mode);
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
}: {
  readonly legs: readonly RankingLeg[];
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
      <JourneyItineraryDetails itinerary={itinerary} />
    </div>
  );
}
