import {
  isMotisTransitLeg,
  isMotisWalkLeg,
  motisPlanModeLabel,
  type MotisItineraryJson,
  type MotisLegJson,
  type MotisPlaceJson,
} from '@railmeet/shared';

import {
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
  stopCountLabel,
} from '@/lib/journey-leg-presentation';

export type JourneyItineraryContext = {
  readonly participantDisplayName?: string;
  readonly originLabel?: string;
  readonly destinationLabel?: string;
};

export type TransferBreakdown = {
  readonly connectionSeconds: number;
  readonly walkSeconds: number | null;
  readonly waitingSeconds: number | null;
  readonly fromPlatform: string | undefined;
  readonly toPlatform: string | undefined;
  readonly fromStop: string;
  readonly toStop: string;
  readonly stationChange: boolean;
};

export type TimelineDateSeparator = {
  readonly kind: 'date-separator';
  readonly label: string;
  readonly timeZone: string | undefined;
};

export type TimelineWalk = {
  readonly kind: 'walk';
  readonly leg: MotisLegJson;
  readonly role: 'initial' | 'transfer' | 'final' | 'standalone';
};

export type TimelineTransfer = {
  readonly kind: 'transfer';
  readonly breakdown: TransferBreakdown;
  readonly walkLeg: MotisLegJson | null;
};

export type TimelineTransit = {
  readonly kind: 'transit';
  readonly leg: MotisLegJson;
  readonly isLastTransit: boolean;
};

export type TimelineItem = TimelineDateSeparator | TimelineWalk | TimelineTransfer | TimelineTransit;

const CALENDAR_DAY_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function calendarDayKey(iso: string, timeZone: string | undefined): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const tz = timeZone ?? 'UTC';
  let formatter = CALENDAR_DAY_FORMATTER_CACHE.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    CALENDAR_DAY_FORMATTER_CACHE.set(tz, formatter);
  }
  return formatter.format(date);
}

/** Calendar-day offset between two instants in a station timezone (Transitous dayOffset). */
export function motisDayOffset(
  timestamp: string,
  reference: string,
  timeZone: string | undefined,
): number {
  const tDayKey = calendarDayKey(timestamp, timeZone);
  const refDayKey = calendarDayKey(reference, timeZone);
  if (!tDayKey || !refDayKey) {
    return 0;
  }
  const tDay = Date.parse(tDayKey);
  const refDay = Date.parse(refDayKey);
  if (Number.isNaN(tDay) || Number.isNaN(refDay)) {
    return 0;
  }
  return Math.round((tDay - refDay) / 86_400_000);
}

function weekdayLabel(iso: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: timeZone ?? 'UTC',
  }).format(new Date(iso));
}

function shortDateLabel(iso: string, timeZone: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timeZone ?? 'UTC',
  }).format(date);
}

export function formatMotisDateRange(
  startIso: string,
  endIso: string,
  startTz: string | undefined,
  endTz: string | undefined,
): string {
  const startDay = calendarDayKey(startIso, startTz);
  const endDay = calendarDayKey(endIso, endTz);
  if (!startDay || !endDay || startDay === endDay) {
    return shortDateLabel(startIso, startTz);
  }
  return `${shortDateLabel(startIso, startTz)} – ${shortDateLabel(endIso, endTz)}`;
}

export type StopTimePresentation = {
  readonly live: string;
  readonly scheduled: string | null;
  readonly showScheduledStrike: boolean;
  readonly delayMinutes: number | null;
  readonly dayOffset: number;
  readonly dayOffsetLabel: string | null;
  readonly dateSeparator: string | null;
  readonly stopName: string;
  readonly platform: string | undefined;
  readonly continuesAs: string | null;
  readonly timeZone: string | undefined;
};

export function buildStopTimePresentation(input: {
  readonly place: MotisPlaceJson | undefined;
  readonly timestamp: string | undefined;
  readonly scheduledTimestamp: string | undefined;
  readonly realTime: boolean;
  readonly mode: string;
  readonly journeyStartIso: string;
  readonly previousTimestamp: string | null;
  readonly previousTimeZone: string | undefined;
}): StopTimePresentation | null {
  const { place, timestamp, scheduledTimestamp, realTime, mode, journeyStartIso } = input;
  const timeZone = typeof place?.tz === 'string' ? place.tz : undefined;
  const stopName = placeTitle(place, 'Stop');
  const platform = platformLabel(place, mode);

  if (!timestamp) {
    const switchTo = place?.switchTo;
    let continuesAs: string | null = null;
    if (switchTo && typeof switchTo === 'object') {
      continuesAs = motisServiceLabel(switchTo as MotisLegJson);
    }
    return {
      live: '',
      scheduled: null,
      showScheduledStrike: false,
      delayMinutes: null,
      dayOffset: 0,
      dayOffsetLabel: null,
      dateSeparator: null,
      stopName,
      platform,
      continuesAs,
      timeZone,
    };
  }

  const live = formatMotisClock(timestamp, timeZone);
  const scheduled = scheduledTimestamp ? formatMotisClock(scheduledTimestamp, timeZone) : null;
  const showScheduledStrike = Boolean(realTime && scheduled && scheduled !== live);
  let delayMinutes: number | null = null;
  if (realTime && scheduledTimestamp && timestamp !== scheduledTimestamp) {
    const deltaMs = new Date(timestamp).getTime() - new Date(scheduledTimestamp).getTime();
    if (!Number.isNaN(deltaMs) && deltaMs !== 0) {
      delayMinutes = Math.round(deltaMs / 60_000);
    }
  }
  const dayOffset = motisDayOffset(timestamp, journeyStartIso, timeZone);
  const dayOffsetLabel =
    dayOffset > 0 ? `+${dayOffset} day${dayOffset === 1 ? '' : 's'}` : null;

  let dateSeparator: string | null = null;
  const prevTz = input.previousTimeZone ?? timeZone;
  const prevTs = input.previousTimestamp;
  if (prevTs) {
    const prevDay = calendarDayKey(prevTs, prevTz);
    const thisDay = calendarDayKey(timestamp, timeZone);
    if (prevDay && thisDay && prevDay !== thisDay) {
      dateSeparator = shortDateLabel(timestamp, timeZone);
    }
  } else if (dayOffset > 0) {
    dateSeparator = shortDateLabel(timestamp, timeZone);
  }

  const switchTo = place?.switchTo;
  let continuesAs: string | null = null;
  if (switchTo && typeof switchTo === 'object') {
    continuesAs = motisServiceLabel(switchTo as MotisLegJson);
  }

  return {
    live,
    scheduled: scheduled && scheduled !== live ? scheduled : null,
    showScheduledStrike,
    delayMinutes,
    dayOffset,
    dayOffsetLabel,
    dateSeparator,
    stopName,
    platform,
    continuesAs,
    timeZone,
  };
}

export function computeTransferBreakdown(
  prevTransit: MotisLegJson,
  nextTransit: MotisLegJson,
  walkLeg: MotisLegJson | null,
): TransferBreakdown {
  const connectionSeconds = Math.max(
    0,
    Math.round(
      (new Date(nextTransit.startTime).getTime() - new Date(prevTransit.endTime).getTime()) / 1000,
    ),
  );
  const walkSeconds =
    walkLeg && isWalkLike(walkLeg) ? Math.max(0, Math.round(walkLeg.duration)) : null;
  const waitingSeconds =
    walkSeconds !== null ? Math.max(0, connectionSeconds - walkSeconds) : null;

  const fromStop = placeTitle(prevTransit.to, 'Stop');
  const toStop = placeTitle(nextTransit.from, 'Stop');
  const fromPlatform = platformLabel(prevTransit.to, prevTransit.mode);
  const toPlatform = platformLabel(nextTransit.from, nextTransit.mode);

  return {
    connectionSeconds,
    walkSeconds,
    waitingSeconds,
    fromPlatform,
    toPlatform,
    fromStop,
    toStop,
    stationChange: fromStop.trim().toLowerCase() !== toStop.trim().toLowerCase(),
  };
}

function isRelevantLeg(leg: MotisLegJson): boolean {
  return leg.duration !== 0 || isMotisTransitLeg(leg);
}

function findPreviousTransit(legs: readonly MotisLegJson[], index: number): MotisLegJson | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const leg = legs[i];
    if (leg && isMotisTransitLeg(leg)) {
      return leg;
    }
  }
  return null;
}

function findNextTransit(legs: readonly MotisLegJson[], index: number): MotisLegJson | null {
  for (let i = index + 1; i < legs.length; i += 1) {
    const leg = legs[i];
    if (leg && isMotisTransitLeg(leg)) {
      return leg;
    }
  }
  return null;
}

export function normalizeLegForDisplay(leg: MotisLegJson): MotisLegJson {
  if (isMotisTransitLeg(leg) || isWalkLike(leg)) {
    return leg;
  }
  return { ...leg, displayName: motisPlanModeLabel(leg.mode) };
}

export function displayLegsForTimeline(itinerary: MotisItineraryJson): MotisLegJson[] {
  return displayLegsFromItinerary(itinerary).map(normalizeLegForDisplay);
}

export function buildTimelineItems(itinerary: MotisItineraryJson): TimelineItem[] {
  const legs = displayLegsForTimeline(itinerary);
  const items: TimelineItem[] = [];
  let lastTimestamp: string | null = null;
  let lastTimeZone: string | undefined;

  const pushDateSeparatorIfNeeded = (iso: string, tz: string | undefined) => {
    if (!lastTimestamp) {
      return;
    }
    const prevDay = calendarDayKey(lastTimestamp, lastTimeZone ?? tz);
    const nextDay = calendarDayKey(iso, tz);
    if (!prevDay || !nextDay || prevDay === nextDay) {
      return;
    }
    items.push({
      kind: 'date-separator',
      label: shortDateLabel(iso, tz),
      timeZone: tz,
    });
  };

  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index]!;
    const prev = index > 0 ? legs[index - 1] : undefined;
    const next = index < legs.length - 1 ? legs[index + 1] : undefined;
    const prevTransit = findPreviousTransit(legs, index);
    const nextTransit = findNextTransit(legs, index);

    if (isMotisTransitLeg(leg)) {
      if (prevTransit) {
        const walkBetween = prev && isWalkLike(prev) ? prev : null;
        items.push({
          kind: 'transfer',
          breakdown: computeTransferBreakdown(prevTransit, leg, walkBetween),
          walkLeg: walkBetween,
        });
      }

      const tz = leg.from?.tz as string | undefined;
      pushDateSeparatorIfNeeded(leg.startTime, tz);
      items.push({
        kind: 'transit',
        leg,
        isLastTransit: !findNextTransit(legs, index),
      });
      lastTimestamp = leg.endTime;
      lastTimeZone = (leg.to?.tz as string | undefined) ?? tz;
      continue;
    }

    if (!isRelevantLeg(leg)) {
      continue;
    }

    if (isWalkLike(leg)) {
      if (prevTransit && nextTransit) {
        continue;
      }

      const role: TimelineWalk['role'] =
        !prevTransit && nextTransit ? 'initial' : prevTransit && !nextTransit ? 'final' : 'standalone';

      const tz = (leg.from?.tz as string | undefined) ?? (leg.to?.tz as string | undefined);
      pushDateSeparatorIfNeeded(leg.startTime, tz);
      items.push({ kind: 'walk', leg, role });
      lastTimestamp = leg.endTime;
      lastTimeZone = tz;
      continue;
    }

    if (prevTransit || nextTransit) {
      const tz = (leg.from?.tz as string | undefined) ?? (leg.to?.tz as string | undefined);
      pushDateSeparatorIfNeeded(leg.startTime, tz);
      items.push({ kind: 'walk', leg, role: 'standalone' });
      lastTimestamp = leg.endTime;
      lastTimeZone = tz;
    }
  }

  return items;
}

export function journeyOverviewHeader(itinerary: MotisItineraryJson, context: JourneyItineraryContext = {}) {
  const legs = displayLegsForTimeline(itinerary);
  const first = legs[0];
  const last = legs[legs.length - 1];
  const startTz = first?.from?.tz as string | undefined;
  const endTz = last?.to?.tz as string | undefined;
  const origin = context.originLabel ?? placeTitle(first?.from, 'Origin');
  const destination = context.destinationLabel ?? placeTitle(last?.to, 'Destination');

  const startClock = formatMotisClock(itinerary.startTime, startTz);
  const endClock = formatMotisClock(itinerary.endTime, endTz);
  const arrivalDayOffset = motisDayOffset(itinerary.endTime, itinerary.startTime, endTz);
  const arrivalSuffix =
    arrivalDayOffset > 0 ? ` (+${arrivalDayOffset} day${arrivalDayOffset === 1 ? '' : 's'})` : '';

  const transitLegs = legs.filter(isMotisTransitLeg);
  const routePills = transitLegs.map((leg) => ({
    label: motisServiceLabel(leg),
    colors: motisChipColors(leg),
    iconKind: motisIconKind(leg),
    mode: leg.mode,
  }));

  return {
    origin,
    destination,
    dateRange: formatMotisDateRange(
      itinerary.startTime,
      itinerary.endTime,
      startTz,
      endTz,
    ),
    timeRange: `${startClock} → ${endClock}${arrivalSuffix}`,
    durationLabel: formatMotisDuration(itinerary.duration),
    transfersLabel: `${itinerary.transfers} transfer${itinerary.transfers === 1 ? '' : 's'}`,
    routePills,
    participantDisplayName: context.participantDisplayName,
  };
}

export function formatConnectionLabel(seconds: number): string {
  return formatMotisDuration(seconds);
}

export function formatDelayLabel(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs === 0) {
    return 'on time';
  }
  return minutes > 0 ? `${abs} min late` : `${abs} min early`;
}

export function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

export function ticketUrl(leg: MotisLegJson): unknown {
  const tickets = leg.ticketUrls;
  if (!tickets || typeof tickets !== 'object') {
    return undefined;
  }
  return (tickets as { web?: unknown }).web;
}

export function expandableIntermediateStops(leg: MotisLegJson): MotisPlaceJson[] {
  const stops = leg.intermediateStops ?? [];
  return stops.filter((stop) => !stop.switchTo);
}

export function continuesAsStops(leg: MotisLegJson): MotisPlaceJson[] {
  return (leg.intermediateStops ?? []).filter((stop) => stop.switchTo);
}

export { motisServiceLabel, motisOperatorLabel, motisChipColors, motisIconKind, formatMotisDuration, formatMotisDistance, stopCountLabel, isWalkLike, isMotisWalkLeg, isMotisTransitLeg, displayLegsFromItinerary, weekdayLabel };
