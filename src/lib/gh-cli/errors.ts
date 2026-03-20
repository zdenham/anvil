/**
 * Error types for gh CLI operations.
 * Each method throws one of these rather than raw stderr strings.
 */

export class GhCliNotInstalledError extends Error {
  readonly kind = "not-installed" as const;
  constructor() {
    super("GitHub CLI (gh) is not installed");
  }
}

export class GhCliNotAuthenticatedError extends Error {
  readonly kind = "not-authenticated" as const;
  constructor() {
    super("GitHub CLI is not authenticated. Run `gh auth login` to authenticate.");
  }
}

export class GhCliNotGitHubRepoError extends Error {
  readonly kind = "not-github-repo" as const;
  constructor() {
    super("Current directory is not a GitHub repository");
  }
}

export class GhCliApiError extends Error {
  readonly kind = "api-error" as const;
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

export type GhCliError =
  | GhCliNotInstalledError
  | GhCliNotAuthenticatedError
  | GhCliNotGitHubRepoError
  | GhCliApiError;

/**
 * Classify stderr output from gh CLI into a specific error type.
 * Uses pattern matching on known error messages.
 */
export function classifyGhError(stderr: string, exitCode: number): GhCliError {
  const lower = stderr.toLowerCase();

  if (
    lower.includes("command not found") ||
    lower.includes("gh: not found") ||
    (lower.includes("not found") && lower.includes("executable"))
  ) {
    return new GhCliNotInstalledError();
  }
  if (
    lower.includes("not logged in") ||
    lower.includes("authentication") ||
    lower.includes("auth login")
  ) {
    return new GhCliNotAuthenticatedError();
  }
  if (
    lower.includes("not a git repository") ||
    lower.includes("no github remotes") ||
    lower.includes("none of the git remotes")
  ) {
    return new GhCliNotGitHubRepoError();
  }

  // Extract HTTP status code from API errors
  const statusMatch = stderr.match(/HTTP (\d{3})/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

  return new GhCliApiError(stderr.trim() || `gh exited with code ${exitCode}`, statusCode);
}
