import { describe, expect, it } from 'vitest';

import { createDatabase } from './client.js';

describe('createDatabase lifecycle', () => {
  it('does not connect on import and close is idempotent', async () => {
    // Construction alone should not throw; we deliberately use an unreachable port
    // without awaiting any query so import/construction stays side-effect free.
    const database = createDatabase({
      connectionString: 'postgresql://railmeet:railmeet@127.0.0.1:1/railmeet',
      maxConnections: 1,
    });

    await database.close();
    await database.close();
    expect(true).toBe(true);
  });
});
