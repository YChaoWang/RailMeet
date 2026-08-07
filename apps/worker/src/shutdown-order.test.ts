import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('worker resource close order', () => {
  it('stops dispatcher before closing publisher, redis, and database', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.ts'), 'utf8');
    const stopBody = source.match(/async stop\(\) \{([\s\S]*?)\n\s*\},/);
    expect(stopBody?.[1]).toBeTruthy();
    const body = stopBody![1]!;
    const dispatcherStop = body.indexOf('await dispatcher.stop()');
    const publisherClose = body.indexOf('await publisher.close()');
    const redisClose = body.indexOf('await closeRedisConnection(redis)');
    const databaseClose = body.indexOf('await database.close()');
    expect(dispatcherStop).toBeGreaterThan(-1);
    expect(publisherClose).toBeGreaterThan(dispatcherStop);
    expect(redisClose).toBeGreaterThan(publisherClose);
    expect(databaseClose).toBeGreaterThan(redisClose);
  });
});
