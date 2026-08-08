import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('worker resource close order', () => {
  it('stops consumer before dispatcher, then publisher, redis, and database', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.ts'), 'utf8');
    const stopBody = source.match(/async stop\(\) \{([\s\S]*?)\n\s*\},/);
    expect(stopBody?.[1]).toBeTruthy();
    const body = stopBody![1]!;
    const consumerClose = body.indexOf('await consumer.close(');
    const dispatcherStop = body.indexOf('await dispatcher.stop()');
    const publisherClose = body.indexOf('await publisher.close()');
    const publisherRedisClose = body.indexOf('await closeRedisConnection(publisherRedis)');
    const consumerRedisClose = body.indexOf('await closeRedisConnection(consumerRedis)');
    const databaseClose = body.indexOf('await database.close()');
    expect(consumerClose).toBeGreaterThan(-1);
    expect(dispatcherStop).toBeGreaterThan(consumerClose);
    expect(publisherClose).toBeGreaterThan(dispatcherStop);
    expect(publisherRedisClose).toBeGreaterThan(publisherClose);
    expect(consumerRedisClose).toBeGreaterThan(publisherRedisClose);
    expect(databaseClose).toBeGreaterThan(consumerRedisClose);
  });
});
