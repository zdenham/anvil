/**
 * Shared comment resolution command parsing.
 * Importable by both agents/ (PreToolUse hook) and sidecar/ (HTTP hooks).
 */

export interface CommentResolutionResult {
  ids: string[];
}

/**
 * Parse a `anvil-resolve-comment` Bash command and extract comment IDs.
 * Returns null if the command is not a anvil-resolve-comment call.
 * Returns { ids: [] } if it matches but has invalid args.
 */
export function parseCommentResolution(command: string): CommentResolutionResult | null {
  if (!command.trimStart().startsWith("anvil-resolve-comment")) {
    return null;
  }

  const argsMatch = command.match(/anvil-resolve-comment\s+["']?([^"']+)["']?/);
  if (!argsMatch) {
    return null;
  }

  const ids = argsMatch[1].split(",").map((id) => id.trim()).filter(Boolean);
  return { ids };
}
