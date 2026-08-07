import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 * DATABASE_URL is only required for studio / introspect — generate/check use schema files.
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://railmeet:railmeet@localhost:5432/railmeet',
  },
  strict: true,
  verbose: true,
});
