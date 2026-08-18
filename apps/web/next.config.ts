import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(configDir, '../..'),
  transpilePackages: ['@railmeet/validation', '@railmeet/shared'],
  env: {
    NEXT_PUBLIC_GIT_SHA:
      process.env['VERCEL_GIT_COMMIT_SHA'] || process.env['GIT_SHA'] || 'unknown',
    NEXT_PUBLIC_APP_VERSION: process.env['APP_VERSION'] || '0.0.0-local',
  },
};

export default nextConfig;
