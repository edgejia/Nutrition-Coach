export const FORBIDDEN_GIT_AUTHORITY_ENVIRONMENT: string[];

export function assertNoAmbientGitAuthority(
  env?: Record<string, string | undefined>,
): void;

export function sanitizedGitEnvironment(
  env?: Record<string, string | undefined>,
): Record<string, string>;

export function runAuthoritativeGit(
  args: string[],
  options?: Record<string, unknown>,
): unknown;
