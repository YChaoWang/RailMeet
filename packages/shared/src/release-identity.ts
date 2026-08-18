/**
 * Safe release identity exposed in health endpoints and structured logs.
 * Never includes secrets, database URLs, or credentials.
 */
export type ReleaseIdentity = {
  readonly service: string;
  readonly version: string;
  readonly gitSha: string;
  readonly deployedAt: string;
};

export function buildReleaseIdentity(service: string): ReleaseIdentity {
  return {
    service,
    version: process.env['APP_VERSION'] || '0.0.0-local',
    gitSha: process.env['GIT_SHA'] || process.env['NF_DEPLOYMENT_SHA'] || 'unknown',
    deployedAt: process.env['DEPLOYED_AT'] || new Date().toISOString(),
  };
}
