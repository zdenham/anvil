/**
 * Claude TUI Args Builder
 *
 * Builds CLI args and env vars for spawning a Claude TUI session
 * with the Mort plugin loaded for HTTP hooks.
 */

export interface ClaudeTuiSpawnConfig {
  args: string[];
  env: Record<string, string>;
}

/**
 * Build CLI args and env vars for a Claude TUI PTY session.
 *
 * Includes `--plugin local:<mortDir>` to load the Mort plugin
 * (which provides hooks.json for HTTP hooks back to the sidecar)
 * and env vars for thread identification.
 */
export function buildSpawnConfig(options: {
  mortDir: string;
  threadId: string;
  sessionId?: string;
  model?: string;
  prompt?: string;
  bypassPermissions?: boolean;
}): ClaudeTuiSpawnConfig {
  const model = options.model ?? "claude-sonnet-4-6";
  const bypass = options.bypassPermissions ?? true;

  const args: string[] = [];

  if (bypass) {
    args.push("--permission-mode", "bypassPermissions");
  }

  args.push("--plugin", `local:${options.mortDir}`);
  args.push("--model", model);

  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  if (options.prompt) {
    args.push("--message", options.prompt);
  }

  const env: Record<string, string> = {
    MORT_THREAD_ID: options.threadId,
    MORT_DATA_DIR: options.mortDir,
  };

  return { args, env };
}
