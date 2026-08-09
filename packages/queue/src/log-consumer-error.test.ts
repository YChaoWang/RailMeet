import { describe, expect, it, vi } from 'vitest';

import { logConsumerError, toLoggedError } from './log-consumer-error.js';

describe('logConsumerError', () => {
  it('normalizes non-Error values', () => {
    const err = toLoggedError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');
  });

  it('logs through Pino err field with errorCode', () => {
    const error = vi.fn();
    const logger = { error } as never;
    const failure = new Error('Command timed out');
    logConsumerError(logger, {
      event: 'search_consumer_error',
      message: 'Search consumer error',
      error: failure,
      errorCode: 'Error',
    });
    expect(error).toHaveBeenCalledOnce();
    const [payload, message] = error.mock.calls[0]!;
    expect(message).toBe('Search consumer error');
    expect(payload).toMatchObject({
      event: 'search_consumer_error',
      errorCode: 'Error',
      err: failure,
    });
  });
});
