/**
 * Command dispatch router for the WebSocket server.
 *
 * Routes incoming WS commands to domain-specific dispatch modules by prefix.
 */

import type { SidecarState } from "./state.js";
import { dispatchFs } from "./dispatch/dispatch-fs.js";
import { dispatchGit } from "./dispatch/dispatch-git.js";
import { dispatchWorktree } from "./dispatch/dispatch-worktree.js";
import { dispatchAgent } from "./dispatch/dispatch-agent.js";
import { dispatchMisc } from "./dispatch/dispatch-misc.js";
import { dispatchTerminal } from "./dispatch/dispatch-terminal.js";

/** Terminal and file watcher command names (no shared prefix). */
const TERMINAL_COMMANDS = new Set([
  "spawn_terminal",
  "write_terminal",
  "resize_terminal",
  "kill_terminal",
  "kill_terminals_by_cwd",
  "list_terminals",
  "start_watch",
  "stop_watch",
  "list_watches",
]);

/**
 * Dispatch a command by name, routing to domain-specific handlers.
 *
 * Returns the result value on success, throws on error.
 */
export async function dispatch(
  cmd: string,
  args: Record<string, unknown>,
  state: SidecarState,
): Promise<unknown> {
  if (cmd.startsWith("agent_")) {
    return dispatchAgent(cmd, args, state);
  }
  if (cmd.startsWith("fs_")) {
    return dispatchFs(cmd, args, state);
  }
  if (cmd.startsWith("git_")) {
    return dispatchGit(cmd, args);
  }
  if (cmd.startsWith("worktree_")) {
    return dispatchWorktree(cmd, args);
  }
  if (TERMINAL_COMMANDS.has(cmd)) {
    return dispatchTerminal(cmd, args, state);
  }
  return dispatchMisc(cmd, args, state);
}
