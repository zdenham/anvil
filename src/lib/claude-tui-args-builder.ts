/**
 * Claude TUI Args Builder
 *
 * Builds CLI args and env vars for spawning a Claude TUI session
 * with the Anvil plugin loaded for HTTP hooks.
 */

export interface ClaudeTuiSpawnConfig {
  args: string[];
  env: Record<string, string>;
}

/**
 * Build CLI args and env vars for a Claude TUI PTY session.
 *
 * Includes `--plugin local:<anvilDir>` to load the Anvil plugin
 * (which provides hooks.json for HTTP hooks back to the sidecar)
 * and env vars for thread identification.
 */
export function buildSpawnConfig(options: {
  anvilDir: string;
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

  args.push("--plugin", `local:${options.anvilDir}`);
  args.push("--model", model);

  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  if (options.prompt) {
    args.push("--message", options.prompt);
  }

  const env: Record<string, string> = {
    ANVIL_THREAD_ID: options.threadId,
    ANVIL_DATA_DIR: options.anvilDir,
  };

  return { args, env };
}
