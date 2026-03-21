/**
 * TUI Thread Lifecycle
 *
 * Handles lifecycle events for TUI (Claude CLI) threads.
 * When the PTY backing a TUI thread exits, marks the thread as completed.
 * Supports reviving dead TUI threads via PtyService directly.
 */

import { logger } from "./logger-client";
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import { ptyService } from "@/entities/pty";

/**
 * Marks the TUI thread backed by `connectionId` as completed.
 * Called from terminal exit listeners. No-ops if no TUI thread uses this connection.
 */
export function markTuiThreadCompleted(connectionId: string): void {

  const threads = useThreadStore.getState().threads as Record<string, { id: string; threadKind?: string; terminalId?: string; status: string }>;

  for (const thread of Object.values(threads)) {
    if (thread.terminalId === connectionId && thread.threadKind) {
      if (thread.status === "running" || thread.status === "idle") {
        logger.info("[tui-lifecycle] TUI thread PTY exited, marking completed", {
          threadId: thread.id,
          connectionId,
        });
        threadService.markCompleted(thread.id);
      }
      return;
    }
  }
}

/**
 * Revives a dead TUI thread by spawning a new PTY via PtyService.
 * The connectionId (stored as `terminalId` on the thread) is reused.
 */
export async function reviveTuiThread(
  threadId: string,
  connectionId: string,
  cwd: string,
  cols = 80,
  rows = 24,
): Promise<void> {
  logger.info("[tui-lifecycle] Reviving TUI thread", { threadId, connectionId });

  const ptyId = await ptyService.revive(connectionId, cwd, cols, rows);

  await threadService.update(threadId, { status: "running" });

  logger.info("[tui-lifecycle] TUI thread revived", { threadId, connectionId, ptyId });
}
