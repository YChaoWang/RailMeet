import type { TransportMode } from './transport-mode.js';

/**
 * Travel window and journey limits applied to every participant in a search.
 *
 * Time fields are wall-clock values with timezone semantics documented in
 * `docs/domain.md`. They are not UTC instants.
 */
export type SearchConstraints = {
  /**
   * Calendar date of travel (`YYYY-MM-DD`), not a UTC timestamp.
   * Earliest departure is interpreted in each origin's local timezone on this date.
   */
  readonly travelDate: string;
  /**
   * Earliest acceptable departure local time (`HH:mm`) at each participant's origin.
   */
  readonly earliestDepartureTime: string;
  /**
   * Latest acceptable arrival local time (`HH:mm`) at the candidate meeting city,
   * on `travelDate + arrivalDayOffset`.
   */
  readonly latestArrivalTime: string;
  /**
   * `0` = arrive on `travelDate`; `1` = arrive the next calendar day (overnight).
   */
  readonly arrivalDayOffset: 0 | 1;
  /** Maximum journey duration per participant, in whole minutes. */
  readonly maxJourneyDurationMinutes: number;
  /** Maximum transfers allowed per participant journey. */
  readonly maxTransfers: number;
  /** Minimum connection time between legs, in whole minutes. */
  readonly minTransferDurationMinutes: number;
  /** Non-empty set of allowed public-transport modes. */
  readonly allowedTransportModes: readonly TransportMode[];
  /**
   * Optional ISO 3166-1 alpha-2 country filter for candidate meeting cities.
   * Uppercase codes only when present.
   */
  readonly allowedCountryCodes?: readonly string[];
};
