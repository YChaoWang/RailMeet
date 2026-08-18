import { afterEach, describe, expect, it } from 'vitest';

import { buildReleaseIdentity } from './release-identity.js';

const originalGitSha = process.env['GIT_SHA'];
const originalNfDeploymentSha = process.env['NF_DEPLOYMENT_SHA'];
const originalAppVersion = process.env['APP_VERSION'];
const originalDeployedAt = process.env['DEPLOYED_AT'];

afterEach(() => {
  restoreEnv('GIT_SHA', originalGitSha);
  restoreEnv('NF_DEPLOYMENT_SHA', originalNfDeploymentSha);
  restoreEnv('APP_VERSION', originalAppVersion);
  restoreEnv('DEPLOYED_AT', originalDeployedAt);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe('buildReleaseIdentity gitSha', () => {
  it('prefers GIT_SHA over NF_DEPLOYMENT_SHA', () => {
    process.env['GIT_SHA'] = 'explicit-override-sha';
    process.env['NF_DEPLOYMENT_SHA'] = 'northflank-sha';

    expect(buildReleaseIdentity('railmeet-api').gitSha).toBe('explicit-override-sha');
  });

  it('uses NF_DEPLOYMENT_SHA when GIT_SHA is absent', () => {
    delete process.env['GIT_SHA'];
    process.env['NF_DEPLOYMENT_SHA'] = 'northflank-sha';

    expect(buildReleaseIdentity('railmeet-api').gitSha).toBe('northflank-sha');
  });

  it('uses unknown when both GIT_SHA and NF_DEPLOYMENT_SHA are absent', () => {
    delete process.env['GIT_SHA'];
    delete process.env['NF_DEPLOYMENT_SHA'];

    expect(buildReleaseIdentity('railmeet-api').gitSha).toBe('unknown');
  });
});
