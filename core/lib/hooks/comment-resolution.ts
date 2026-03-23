/**
 * Shared comment resolution command parsing.
 * Importable by both agents/ (PreToolUse hook) and sidecar/ (HTTP hooks).
 */

export interface CommentResolutionResult {
  ids: string[];
}

/**
 * Parse a `mort-resolve-comment` Bash command and extract comment IDs.
 * Returns null if the command is not a mort-resolve-comment call.
 * Returns { ids: [] } if it matches but has invalid args.
 */
export function parseCommentResolution(command: string): CommentResolutionResult | null {
  if (!command.trimStart().startsWith("mort-resolve-comment")) {
    return null;
  }

  const argsMatch = command.match(/mort-resolve-comment\s+["']?([^"']+)["']?/);
  if (!argsMatch) {
    return null;
  }

  const ids = argsMatch[1].split(",").map((id) => id.trim()).filter(Boolean);
  return { ids };
}
