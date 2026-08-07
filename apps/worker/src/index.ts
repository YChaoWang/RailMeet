import { loadWorkerConfig } from '@railmeet/config';

import { buildWorker } from './app.js';

async function main(): Promise<void> {
  try {
    const config = loadWorkerConfig();
    const worker = await buildWorker({ config });
    worker.start();
  } catch (error) {
    // Startup failures (invalid config, etc.) exit non-zero.
    console.error(error);
    process.exit(1);
  }
}

void main();
