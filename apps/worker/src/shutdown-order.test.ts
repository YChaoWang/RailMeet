import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('worker resource close order', () => {
  it('stops consumers before dispatcher, then publisher, redis, and database', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.ts'), 'utf8');
    const stopBody = source.match(/async stop\(\) \{([\s\S]*?)\n\s*\},/);
    expect(stopBody?.[1]).toBeTruthy();
    const body = stopBody![1]!;

    const consumersClose = body.indexOf('Promise.all([');
    const consumerClose = body.indexOf('consumer.close(');
    const candidateClose = body.indexOf('candidateConsumer.close(');
    const routingClose = body.indexOf('routingConsumer.close(');
    const dispatcherStop = body.indexOf('await dispatcher.stop()');
    const publisherClose = body.indexOf('await publisher.close()');
    const publisherRedisClose = body.indexOf('await closeRedisConnection(publisherRedis)');
    const kickoffRedisClose = body.indexOf('await closeRedisConnection(kickoffRedis)');
    const candidateRedisClose = body.indexOf('await closeRedisConnection(candidateRedis)');
    const routingRedisClose = body.indexOf('await closeRedisConnection(routingRedis)');
    const databaseClose = body.indexOf('await database.close()');

    expect(consumersClose).toBeGreaterThan(-1);
    expect(consumerClose).toBeGreaterThan(consumersClose);
    expect(candidateClose).toBeGreaterThan(consumersClose);
    expect(routingClose).toBeGreaterThan(consumersClose);
    expect(dispatcherStop).toBeGreaterThan(routingClose);
    expect(publisherClose).toBeGreaterThan(dispatcherStop);
    expect(publisherRedisClose).toBeGreaterThan(publisherClose);
    expect(kickoffRedisClose).toBeGreaterThan(publisherRedisClose);
    expect(candidateRedisClose).toBeGreaterThan(kickoffRedisClose);
    expect(routingRedisClose).toBeGreaterThan(candidateRedisClose);
    expect(databaseClose).toBeGreaterThan(routingRedisClose);
  });
});
