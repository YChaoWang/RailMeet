import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(configDir, '../..'),
  transpilePackages: ['@railmeet/validation', '@railmeet/shared'],
};

export default nextConfig;
