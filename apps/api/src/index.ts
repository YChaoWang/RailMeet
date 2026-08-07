import { loadApiConfig } from '@railmeet/config';
import { createDatabase } from '@railmeet/database';
import { createLogger } from '@railmeet/observability';

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

  const app = await buildServer({ logger, database });

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
