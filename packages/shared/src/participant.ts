import type { PlaceReference } from './place.js';

/**
 * A person included in a meeting search, departing from one origin place.
 */
export type Participant = {
  /** Stable ID unique within a single search request. */
  readonly id: string;
  /** Human-readable name shown in UI and explanations. */
  readonly displayName: string;
  /** Provider-neutral origin place. */
  readonly origin: PlaceReference;
};
