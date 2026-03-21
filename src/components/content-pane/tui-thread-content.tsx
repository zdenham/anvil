/**
 * TuiThreadContent
 *
 * Thin wrapper that renders a TerminalContent for a TUI thread.
 * Shown when a thread has `threadKind` set (e.g. "claude-tui").
 *
 * TUI threads own their PTY via PtyService directly (no TerminalSession).
 * This component handles revive for dead TUI PTYs.
 */

import { useEffect, useCallback } from "react";
import type { ThreadMetadata } from "@/entities/threads/types";
import { ptyService } from "@/entities/pty";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { reviveTuiThread } from "@/lib/tui-thread-lifecycle";
import { logger } from "@/lib/logger-client";
import { TerminalContent } from "./terminal-content";
import { EmptyPaneContent } from "./empty-pane-content";

interface TuiThreadContentProps {
  thread: ThreadMetadata;
}

export function TuiThreadContent({ thread }: TuiThreadContentProps) {
  if (!thread.terminalId) {
    return <EmptyPaneContent />;
  }

  return <TuiThreadContentInner thread={thread} connectionId={thread.terminalId} />;
}

function TuiThreadContentInner({
  thread,
  connectionId,
}: {
  thread: ThreadMetadata;
  connectionId: string;
}) {
  const worktreePath = useRepoWorktreeLookupStore(
    useCallback(
      (s) => s.getWorktreePath(thread.repoId, thread.worktreeId),
      [thread.repoId, thread.worktreeId],
    ),
  );

  // Auto-revive dead TUI PTYs when this component is displayed
  useEffect(() => {
    const isCompleted = thread.status === "completed" || thread.status === "error" || thread.status === "cancelled";
    const hasPty = ptyService.getPtyIdOrUndefined(connectionId) !== undefined;

    if (!isCompleted && !hasPty && !ptyService.isReviving(connectionId) && worktreePath) {
      reviveTuiThread(thread.id, connectionId, worktreePath).catch((err) => {
        logger.warn("[TuiThreadContent] Failed to revive TUI thread (non-fatal):", err);
      });
    }
  }, [thread.id, thread.status, connectionId, worktreePath]);

  return <TerminalContent key={connectionId} terminalId={connectionId} />;
}
