/**
 * React hooks for terminal sessions.
 */
import { useCallback, useMemo } from "react";
import { useTerminalSessionStore } from "./store";
import { terminalSessionService } from "./service";
import { getOutputBuffer } from "./output-buffer";
import type { TerminalSession } from "./types";

/**
 * Hook to get all terminal sessions.
 */
export function useTerminalSessions(): TerminalSession[] {
  return useTerminalSessionStore((state) => state._sessionsArray);
}

/**
 * Hook to get terminal sessions for a specific worktree.
 */
export function useTerminalSessionsByWorktree(
  worktreeId: string
): TerminalSession[] {
  const sessions = useTerminalSessionStore((state) => state._sessionsArray);
  return useMemo(
    () => sessions.filter((s) => s.worktreeId === worktreeId),
    [sessions, worktreeId]
  );
}

/**
 * Hook to get a single terminal session by ID.
 */
export function useTerminalSession(
  id: string | undefined
): TerminalSession | undefined {
  return useTerminalSessionStore((state) =>
    id ? state.sessions[id] : undefined
  );
}

/**
 * Hook to get the output buffer for a terminal.
 * Reads from the plain Map (not Zustand) — snapshot at call time.
 */
export function useTerminalOutputBuffer(id: string): string {
  return getOutputBuffer(id);
}

/**
 * Hook providing terminal session actions.
 */
export function useTerminalActions() {
  const createTerminal = useCallback(
    async (
      worktreeId: string,
      worktreePath: string,
      cols?: number,
      rows?: number
    ) => {
      return terminalSessionService.create(worktreeId, worktreePath, cols, rows);
    },
    []
  );

  const archiveTerminal = useCallback(async (id: string) => {
    return terminalSessionService.archive(id);
  }, []);

  const writeToTerminal = useCallback(async (id: string, data: string) => {
    return terminalSessionService.write(id, data);
  }, []);

  const resizeTerminal = useCallback(
    async (id: string, cols: number, rows: number) => {
      return terminalSessionService.resize(id, cols, rows);
    },
    []
  );

  return {
    createTerminal,
    archiveTerminal,
    writeToTerminal,
    resizeTerminal,
  };
}
