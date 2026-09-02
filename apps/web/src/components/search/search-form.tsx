'use client';

import {
  PARTICIPANT_COUNT_MAX,
  PARTICIPANT_COUNT_MIN,
  TRANSPORT_MODES,
  type RankingMode,
  type TransportMode,
} from '@railmeet/shared';
import {
  createMeetingSearchRequestSchema,
  type PlaceSuggestionView,
  type SelectedPlaceOrigin,
} from '@railmeet/validation';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent } from 'react';

import { PlaceCombobox } from '@/components/search/place-combobox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createMeetingSearch } from '@/lib/meeting-search-client';
import { travelerColorAt, travelerLetterAt } from '@/lib/traveler-identity';

export type ParticipantDraft = {
  /** Stable React/map identity for this draft row — never reuse array index. */
  readonly key: string;
  id: string;
  displayName: string;
  originText: string;
  originSelected: PlaceSuggestionView | null;
  readonly letter: string;
  readonly color: string;
};

type FieldErrors = Record<string, string>;

let travelerIdentitySeq = 0;

function allocateTravelerIdentity(): { letter: string; color: string; seq: number } {
  const seq = travelerIdentitySeq;
  travelerIdentitySeq += 1;
  return {
    seq,
    letter: travelerLetterAt(seq),
    color: travelerColorAt(seq),
  };
}

function newParticipant(): ParticipantDraft {
  const identity = allocateTravelerIdentity();
  return {
    key: crypto.randomUUID(),
    id: `traveler-${identity.seq + 1}`,
    displayName: '',
    originText: '',
    originSelected: null,
    letter: identity.letter,
    color: identity.color,
  };
}

export type ParticipantsUpdater =
  ParticipantDraft[] | ((previous: ParticipantDraft[]) => ParticipantDraft[]);

export type SearchFormProps = {
  readonly participants: ParticipantDraft[];
  readonly onParticipantsChange: (next: ParticipantsUpdater) => void;
};

function toSelectedOrigin(suggestion: PlaceSuggestionView): SelectedPlaceOrigin {
  return {
    providerId: suggestion.providerId,
    name: suggestion.name,
    type: suggestion.type,
    latitude: suggestion.latitude,
    longitude: suggestion.longitude,
    countryCode: suggestion.countryCode,
    timezone: suggestion.timezone,
    modes: [...suggestion.modes],
    secondaryLabel: suggestion.secondaryLabel,
  };
}

const RANKING_OPTIONS: { value: RankingMode; label: string }[] = [
  { value: 'fairest', label: 'Fairest' },
  { value: 'fastest-overall', label: 'Fastest overall' },
  { value: 'fewest-transfers', label: 'Fewest transfers' },
  { value: 'arrive-together', label: 'Arrive together' },
];

export function SearchForm({ participants, onParticipantsChange }: SearchFormProps) {
  const router = useRouter();
  const formId = useId();
  const submittingRef = useRef(false);
  const [travelDate, setTravelDate] = useState('2026-09-15');
  const [earliestDepartureTime, setEarliestDepartureTime] = useState('08:00');
  const [latestArrivalTime, setLatestArrivalTime] = useState('22:00');
  const [arrivalDayOffset, setArrivalDayOffset] = useState<'0' | '1'>('0');
  const [maxJourneyDurationMinutes, setMaxJourneyDurationMinutes] = useState('480');
  const [maxTransfers, setMaxTransfers] = useState('2');
  const [minTransferDurationMinutes, setMinTransferDurationMinutes] = useState('5');
  const [modes, setModes] = useState<TransportMode[]>(['train']);
  const [rankingMode, setRankingMode] = useState<RankingMode>('fairest');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const allOriginsSelected = participants.every((participant) => participant.originSelected);

  const focusFirstInvalid = (nextErrors: FieldErrors) => {
    const firstPath = Object.keys(nextErrors)[0];
    if (!firstPath) {
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(firstPath)}"]`);
    el?.focus();
  };

  const toggleMode = (mode: TransportMode, checked: boolean) => {
    setModes((current) => {
      if (checked) {
        return current.includes(mode) ? current : [...current, mode];
      }
      return current.filter((value) => value !== mode);
    });
  };

  const updateParticipant = (key: string, patch: Partial<ParticipantDraft>) => {
    onParticipantsChange((previous) =>
      previous.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    const originErrors: FieldErrors = {};
    for (const [index, participant] of participants.entries()) {
      const path = `participants.${index}.origin`;
      if (!participant.originText.trim()) {
        originErrors[path] = 'Choose a starting place';
      } else if (!participant.originSelected) {
        originErrors[path] = 'Select a place from the suggestions';
      } else if (!participant.originSelected.countryCode) {
        originErrors[path] = 'Selected place is missing a country code';
      }
    }
    if (Object.keys(originErrors).length > 0) {
      setErrors(originErrors);
      setFormError('Every traveler needs a selected station or city.');
      queueMicrotask(() => focusFirstInvalid(originErrors));
      return;
    }

    submittingRef.current = true;
    setPending(true);
    setFormError(null);

    const payload = {
      participants: participants.map((participant) => ({
        id: participant.id.trim(),
        displayName: participant.displayName.trim() || `Traveler ${participant.letter}`,
        origin: toSelectedOrigin(participant.originSelected!),
      })),
      travelDate,
      earliestDepartureTime,
      latestArrivalTime,
      arrivalDayOffset: Number(arrivalDayOffset) as 0 | 1,
      maxJourneyDurationMinutes: Number(maxJourneyDurationMinutes),
      maxTransfers: Number(maxTransfers),
      minTransferDurationMinutes: Number(minTransferDurationMinutes),
      allowedTransportModes: modes,
      rankingMode,
    };

    const parsed = createMeetingSearchRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || '(root)';
        if (!nextErrors[path]) {
          nextErrors[path] = issue.message;
        }
      }
      setErrors(nextErrors);
      setPending(false);
      submittingRef.current = false;
      queueMicrotask(() => focusFirstInvalid(nextErrors));
      return;
    }

    setErrors({});
    try {
      const result = await createMeetingSearch(parsed.data);
      if (!result.ok) {
        const nextErrors: FieldErrors = {};
        for (const detail of result.error.details ?? []) {
          nextErrors[detail.path] = detail.message;
        }
        setErrors(nextErrors);
        setFormError(result.error.message);
        setPending(false);
        submittingRef.current = false;
        queueMicrotask(() => focusFirstInvalid(nextErrors));
        return;
      }
      router.push(`/search/${result.data.searchId}`);
    } catch {
      setFormError('We could not reach RailMeet. Check your connection and try again.');
      setPending(false);
      submittingRef.current = false;
    }
  };

  return (
    <form
      id={formId}
      onSubmit={onSubmit}
      className="min-w-0 space-y-5"
      noValidate
      aria-label="Meeting search"
      data-testid="search-form"
    >
      <section className="min-w-0 space-y-3" data-testid="search-form-travelers">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-950">Travelers</h2>
          <p className="text-xs text-ink-700">
            {PARTICIPANT_COUNT_MIN}–{PARTICIPANT_COUNT_MAX}
          </p>
        </div>
        {participants.map((participant, index) => (
          <div
            key={participant.key}
            className="grid min-w-0 gap-2 border-b border-ink-700/10 pb-3 last:border-b-0"
            data-testid="search-form-traveler-row"
          >
            <div className="flex items-center gap-2">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: participant.color }}
                aria-hidden
              >
                {participant.letter}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={`${participant.key}-name`} className="sr-only">
                  Traveler {participant.letter} name
                </Label>
                <Input
                  id={`${participant.key}-name`}
                  data-field={`participants.${index}.displayName`}
                  value={participant.displayName}
                  placeholder={`Name (optional — defaults to Traveler ${participant.letter})`}
                  aria-invalid={Boolean(errors[`participants.${index}.displayName`])}
                  aria-describedby={
                    errors[`participants.${index}.displayName`]
                      ? `${participant.key}-name-error`
                      : undefined
                  }
                  onChange={(event) => {
                    updateParticipant(participant.key, { displayName: event.target.value });
                  }}
                />
                {errors[`participants.${index}.displayName`] ? (
                  <p id={`${participant.key}-name-error`} className="text-sm text-red-700">
                    {errors[`participants.${index}.displayName`]}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${participant.key}-origin`}>Starting place</Label>
              <PlaceCombobox
                id={`${participant.key}-origin`}
                fieldPath={`participants.${index}.origin`}
                valueText={participant.originText}
                selected={participant.originSelected}
                disabled={pending}
                invalid={Boolean(errors[`participants.${index}.origin`])}
                onTextChange={(text) => updateParticipant(participant.key, { originText: text })}
                onSelect={(suggestion) =>
                  updateParticipant(participant.key, {
                    originSelected: suggestion,
                    originText: suggestion.name,
                  })
                }
                onClearSelection={() =>
                  updateParticipant(participant.key, { originSelected: null })
                }
              />
              {errors[`participants.${index}.origin`] ? (
                <p className="text-sm text-red-700">{errors[`participants.${index}.origin`]}</p>
              ) : null}
            </div>
          </div>
        ))}
        {errors.participants ? <p className="text-sm text-red-700">{errors.participants}</p> : null}
        <div className="flex flex-wrap gap-2" data-testid="search-form-traveler-actions">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11"
            disabled={participants.length >= PARTICIPANT_COUNT_MAX || pending}
            onClick={() => onParticipantsChange((previous) => [...previous, newParticipant()])}
          >
            Add traveler
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={participants.length <= PARTICIPANT_COUNT_MIN || pending}
            onClick={() => onParticipantsChange((previous) => previous.slice(0, -1))}
          >
            Remove last
          </Button>
        </div>
      </section>

      <section
        className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2"
        data-testid="search-form-schedule"
      >
        <div className="space-y-1.5 md:col-span-2">
          <h2 className="text-sm font-semibold text-ink-950">When & preference</h2>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="travelDate">Travel date</Label>
          <Input
            id="travelDate"
            data-field="travelDate"
            type="date"
            value={travelDate}
            onChange={(event) => setTravelDate(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rankingMode">Ranking preference</Label>
          <Select
            value={rankingMode}
            onValueChange={(value) => setRankingMode(value as RankingMode)}
          >
            <SelectTrigger id="rankingMode" data-field="rankingMode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANKING_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="earliestDepartureTime">Earliest departure</Label>
          <Input
            id="earliestDepartureTime"
            data-field="earliestDepartureTime"
            type="time"
            value={earliestDepartureTime}
            onChange={(event) => setEarliestDepartureTime(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="latestArrivalTime">Latest arrival</Label>
          <Input
            id="latestArrivalTime"
            data-field="latestArrivalTime"
            type="time"
            value={latestArrivalTime}
            onChange={(event) => setLatestArrivalTime(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="arrivalDayOffset">Arrival day</Label>
          <Select
            value={arrivalDayOffset}
            onValueChange={(value) => setArrivalDayOffset(value as '0' | '1')}
          >
            <SelectTrigger id="arrivalDayOffset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Same day</SelectItem>
              <SelectItem value="1">Next day</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxJourneyDurationMinutes">Max journey minutes</Label>
          <Input
            id="maxJourneyDurationMinutes"
            data-field="maxJourneyDurationMinutes"
            inputMode="numeric"
            value={maxJourneyDurationMinutes}
            onChange={(event) => setMaxJourneyDurationMinutes(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxTransfers">Max transfers</Label>
          <Input
            id="maxTransfers"
            data-field="maxTransfers"
            inputMode="numeric"
            value={maxTransfers}
            onChange={(event) => setMaxTransfers(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="minTransferDurationMinutes">Min transfer minutes</Label>
          <Input
            id="minTransferDurationMinutes"
            data-field="minTransferDurationMinutes"
            inputMode="numeric"
            value={minTransferDurationMinutes}
            onChange={(event) => setMinTransferDurationMinutes(event.target.value)}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-950">Transport modes</h2>
        <div className="flex flex-wrap gap-3">
          {TRANSPORT_MODES.map((mode) => (
            <label key={mode} className="flex min-h-11 items-center gap-2 text-sm capitalize">
              <Checkbox
                checked={modes.includes(mode)}
                onCheckedChange={(checked) => toggleMode(mode, checked === true)}
                data-field="allowedTransportModes"
              />
              {mode}
            </label>
          ))}
        </div>
        {errors.allowedTransportModes ? (
          <p className="text-sm text-red-700">{errors.allowedTransportModes}</p>
        ) : null}
      </section>

      {formError || Object.keys(errors).length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Check the form</AlertTitle>
          <AlertDescription>
            {formError ?? 'Some fields need attention before we can start planning.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending || !allOriginsSelected}
        aria-busy={pending}
      >
        {pending ? 'Starting search…' : 'Find a meeting point'}
      </Button>
    </form>
  );
}

export function createInitialParticipants(): ParticipantDraft[] {
  // Stable keys/letters for SSR + hydration — do not use crypto.randomUUID() here.
  travelerIdentitySeq = 2;
  return [
    {
      key: 'draft-traveler-a',
      id: 'traveler-1',
      displayName: '',
      originText: '',
      originSelected: null,
      letter: 'A',
      color: travelerColorAt(0),
    },
    {
      key: 'draft-traveler-b',
      id: 'traveler-2',
      displayName: '',
      originText: '',
      originSelected: null,
      letter: 'B',
      color: travelerColorAt(1),
    },
  ];
}

/** Test helper: reset the draft identity counter between tests. */
export function resetTravelerIdentitySeqForTests(): void {
  travelerIdentitySeq = 0;
}
