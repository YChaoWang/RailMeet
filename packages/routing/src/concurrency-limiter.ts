import type { JourneyPlanner, PlanJourneyInput, PlanJourneyResult } from './types.js';

/**
 * Limits concurrent in-flight calls to an inner journey planner (process-local semaphore).
 */
export function createConcurrencyLimitedJourneyPlanner(options: {
  readonly inner: JourneyPlanner;
  readonly maxConcurrent: number;
}): JourneyPlanner {
  const maxConcurrent = Math.max(1, options.maxConcurrent);
  let inFlight = 0;
  const waiters: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (inFlight < maxConcurrent) {
      inFlight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiters.push(() => {
        inFlight += 1;
        resolve();
      });
    });
  };

  const release = (): void => {
    inFlight = Math.max(0, inFlight - 1);
    const next = waiters.shift();
    if (next) {
      next();
    }
  };

  return {
    async planJourney(input: PlanJourneyInput): Promise<PlanJourneyResult> {
      await acquire();
      try {
        return await options.inner.planJourney(input);
      } finally {
        release();
      }
    },
  };
}
