import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findEnvFile } from './index.js';

describe('findEnvFile', () => {
  it('finds a .env file in an ancestor directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'railmeet-config-'));
    const nested = join(root, 'apps', 'api');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, '.env'), 'LOG_LEVEL=info\n', 'utf8');

    expect(findEnvFile(nested)).toBe(join(root, '.env'));
  });

  it('returns undefined when no .env exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'railmeet-config-empty-'));
    const nested = join(root, 'apps', 'api');
    mkdirSync(nested, { recursive: true });

    expect(findEnvFile(nested)).toBeUndefined();
  });
});
