/**
 * Terminal session event listeners.
 * Connects Tauri PTY events to the frontend store and disk persistence.
 *
 * Uses PtyService for ptyId → connectionId resolution. Routes events to
 * both terminal sessions and TUI thread lifecycle.
 */
import { listen } from "@/lib/events";
import { useTerminalSessionStore } from "./store";
import { terminalSessionService } from "./service";
import { appendOutput } from "@/entities/pty/output-buffer";
import { ptyService } from "@/entities/pty";
import { logger } from "@/lib/logger-client";
import { markTuiThreadCompleted } from "@/lib/tui-thread-lifecycle";

interface TerminalOutputPayload {
  id: number;
  data: string;
}

interface TerminalExitPayload {
  id: number;
}

interface TerminalKilledPayload {
  id: number;
}

/**
 * Sets up listeners for terminal PTY events from Rust.
 * Call this once during app initialization.
 */
export function setupTerminalListeners(): () => void {
  const unlisteners: Array<() => void> = [];

  // Listen for terminal output — decode once, store + notify subscribers
  listen<TerminalOutputPayload>("terminal:output", (event) => {
    const { id, data } = event.payload;
    const connId = ptyService.resolveByPtyId(id);
    if (!connId) return; // Unknown PTY ID — ignore
    appendOutput(connId, data);
  }).then((unlisten) => unlisteners.push(unlisten));

  // Listen for terminal exit (process ended)
  listen<TerminalExitPayload>("terminal:exit", (event) => {
    const ptyId = event.payload.id;
    const connId = ptyService.resolveByPtyId(ptyId);
    if (!connId) return;

    logger.info("[TerminalListeners] PTY exited", { connectionId: connId, ptyId });

    // Check if this is a terminal session
    const session = terminalSessionService.get(connId);
    if (session) {
      terminalSessionService.markExited(connId);
    }

    // Check if this backs a TUI thread (works for both cases)
    markTuiThreadCompleted(connId);
  }).then((unlisten) => unlisteners.push(unlisten));

  // Listen for terminal killed (archived)
  listen<TerminalKilledPayload>("terminal:killed", (event) => {
    const ptyId = event.payload.id;
    const connId = ptyService.resolveByPtyId(ptyId);
    if (!connId) return;

    logger.info("[TerminalListeners] PTY killed", { connectionId: connId, ptyId });
    useTerminalSessionStore.getState().removeSession(connId);
  }).then((unlisten) => unlisteners.push(unlisten));

  logger.info("[TerminalListeners] Terminal event listeners set up");

  // Return cleanup function
  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}
