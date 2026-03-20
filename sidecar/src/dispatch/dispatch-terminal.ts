/**
 * Terminal and file watcher command dispatch.
 *
 * Handles 6 terminal commands and 3 file watcher commands.
 */

import { extractArg } from "../helpers.js";
import type { SidecarState } from "../state.js";

export async function dispatchTerminal(
  cmd: string,
  args: Record<string, unknown>,
  state: SidecarState,
): Promise<unknown> {
  switch (cmd) {
    // ── Terminal ───────────────────────────────────────────────────────
    case "spawn_terminal":
      return state.terminalManager.spawn(
        extractArg<number>(args, "cols"),
        extractArg<number>(args, "rows"),
        extractArg<string>(args, "cwd"),
        state.broadcaster,
      );

    case "write_terminal":
      state.terminalManager.write(
        extractArg<number>(args, "id"),
        extractArg<string>(args, "data"),
      );
      return null;

    case "resize_terminal":
      state.terminalManager.resize(
        extractArg<number>(args, "id"),
        extractArg<number>(args, "cols"),
        extractArg<number>(args, "rows"),
      );
      return null;

    case "kill_terminal":
      state.terminalManager.kill(
        extractArg<number>(args, "id"),
        state.broadcaster,
      );
      return null;

    case "kill_terminals_by_cwd":
      return state.terminalManager.killByCwd(
        extractArg<string>(args, "cwd"),
        state.broadcaster,
      );

    case "list_terminals":
      return state.terminalManager.list();

    // ── File Watcher ──────────────────────────────────────────────────
    case "start_watch":
      state.fileWatcherManager.start(
        extractArg<string>(args, "watchId"),
        extractArg<string>(args, "path"),
        extractArg<boolean>(args, "recursive"),
        state.broadcaster,
      );
      return null;

    case "stop_watch":
      state.fileWatcherManager.stop(
        extractArg<string>(args, "watchId"),
      );
      return null;

    case "list_watches":
      return state.fileWatcherManager.list();

    default:
      throw new Error(`unknown terminal/watcher command: ${cmd}`);
  }
}
