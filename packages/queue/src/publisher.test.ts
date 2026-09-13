import { describe, expect, it } from 'vitest';

import { isLiveQueueJob  } from './publisher.js';

describe('isLiveQueueJobState', () => {
  it('treats in-flight BullMQ states as live so recovery does not double-start work', () => {
    expect(isLiveQueueJobState('waiting')).toBe(true);
    expect(isLiveQueueJobState('active')).toBe(true);
    expect(isLiveQueueJobState('delayed')).toBe(true);
    expect(isLiveQueueJobState('paused')).toBe(true);
    expect(isLiveQueueJobState('waiting-children')).toBe(true);
    expect(isLiveQueueJobState('prioritized')).toBe(true);
  });

  it('allows replacement of finished or missing jobs', () => {
    expect(isLiveQueueJobState('completed')).toBe(false);
    expect(isLiveQueueJobState('failed')).toBe(false);
    expect(isLiveQueueJobState('unknown')).toBe(false);
  });
});
