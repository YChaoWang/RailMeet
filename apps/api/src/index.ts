import { loadApiConfig } from '@railmeet/config';
import { createDatabase } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';
import {
  createTransitousMapStopsClient,
  createTransitousPlaceGeocoder,
} from '@railmeet/routing';
import { MAP_STOPS_MAX_RESPONSE_BYTES } from '@railmeet/shared';

import { buildServer } from './app.js';

async function main(): Promise<void> {
  const config = loadApiConfig();
  const logger = createLogger({
    name: 'railmeet-api',
    level: config.logLevel,
    pretty: config.nodeEnv === 'development',
  });

  const database = createDatabase({
    connectionString: config.databaseUrl,
  });

  const transitousOptions = {
    baseUrl: config.transitous.baseUrl,
    userAgent: config.transitous.userAgent,
    timeoutMs: config.transitous.timeoutMs,
    maxResponseBytes: config.transitous.maxResponseBytes,
    logger,
  } as const;

  const placeGeocoder = createTransitousPlaceGeocoder(transitousOptions);
  const mapStopsClient = createTransitousMapStopsClient({
    ...transitousOptions,
    // Dense European viewports exceed the journey-plan response budget.
    maxResponseBytes: Math.max(transitousOptions.maxResponseBytes, MAP_STOPS_MAX_RESPONSE_BYTES),
  });

  const app = await buildServer({ logger, database, placeGeocoder, mapStopsClient });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down API');

    try {
      await app.close();
      logger.info('API closed cleanly');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during API shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info({ host: config.host, port: config.port }, 'API listening');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start API');
    await database.close().catch(() => undefined);
    process.exit(1);
  }
}

void main();
