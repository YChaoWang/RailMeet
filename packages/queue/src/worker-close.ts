import type { Worker } from 'bullmq';

import type { Logger } from '@railmeet/observability';

export type ClosableWorkerHandle = {
  close: (timeoutMs: number) => Promise<'closed' | 'timed_out'>;
};

/**
 * Shared graceful-close helper for BullMQ Workers used by Phase 6/7 consumers.
 */
export function createWorkerCloseHandle(options: {
  readonly worker: Worker;
  readonly logger: Logger;
  readonly stoppingEvent: string;
  readonly stoppedEvent: string;
  readonly timeoutEvent: string;
}): ClosableWorkerHandle {
  let closing = false;
  let closePromise: Promise<void> | undefined;

  return {
    async close(timeoutMs) {
      if (closing) {
        if (closePromise) {
          await closePromise;
        }
        return 'closed';
      }
      closing = true;
      options.logger.info({ event: options.stoppingEvent }, 'Consumer stopping');

      closePromise = options.worker.close();
      const timedOut = await Promise.race([
        closePromise.then(() => false),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(true), timeoutMs);
        }),
      ]);

      if (timedOut) {
        options.logger.warn(
          {
            event: options.timeoutEvent,
            timeoutMs,
          },
          'Consumer graceful close exceeded timeout; stalled-job recovery may reclaim work',
        );
        return 'timed_out';
      }

      options.logger.info({ event: options.stoppedEvent }, 'Consumer stopped');
      return 'closed';
    },
  };
}

export function classifyConsumerError(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'UnrecoverableError'
  ) {
    return 'UNRECOVERABLE';
  }
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  if (error instanceof Error) {
    return error.name;
  }
  return 'UNKNOWN';
}
