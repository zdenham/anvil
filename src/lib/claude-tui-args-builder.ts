/**
 * Claude TUI Args Builder
 *
 * Builds the minimal CLI args and env vars for spawning an unmanaged
 * Claude TUI session. The hook bridge plan will extend this to add
 * `--plugin` and env vars.
 */

export interface ClaudeTuiSpawnConfig {
  args: string[];
  env: Record<string, string>;
}

/**
 * Build CLI args and env vars for a Claude TUI PTY session.
 *
 * Currently returns the bare minimum for an unmanaged session.
 * The hook bridge plan (`plans/claude-tui-hook-bridge.md`) will
 * extend this with `--plugin local:~/.mort` and env vars.
 */
export function buildSpawnConfig(options: {
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

  args.push("--model", model);

  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  if (options.prompt) {
    args.push("--message", options.prompt);
  }

  return { args, env: {} };
}
