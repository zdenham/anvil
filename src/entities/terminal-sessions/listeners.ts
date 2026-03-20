/**
 * Terminal session event listeners.
 * Connects Tauri PTY events to the frontend store and disk persistence.
 */
import { listen } from "@/lib/events";
import { useTerminalSessionStore } from "./store";
import { terminalSessionService } from "./service";
import { appendOutput } from "./output-buffer";
import { logger } from "@/lib/logger-client";

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
    const termId = terminalSessionService.resolveByPtyId(id);
    if (!termId) return; // Unknown PTY ID — ignore
    appendOutput(termId, data);
  }).then((unlisten) => unlisteners.push(unlisten));

  // Listen for terminal exit (process ended)
  listen<TerminalExitPayload>("terminal:exit", (event) => {
    const ptyId = event.payload.id;
    const termId = terminalSessionService.resolveByPtyId(ptyId);
    if (!termId) return;

    logger.info("[TerminalListeners] Terminal exited", { terminalId: termId, ptyId });
    terminalSessionService.markExited(termId);
  }).then((unlisten) => unlisteners.push(unlisten));

  // Listen for terminal killed (archived)
  listen<TerminalKilledPayload>("terminal:killed", (event) => {
    const ptyId = event.payload.id;
    const termId = terminalSessionService.resolveByPtyId(ptyId);
    if (!termId) return;

    logger.info("[TerminalListeners] Terminal killed", { terminalId: termId, ptyId });
    useTerminalSessionStore.getState().removeSession(termId);
  }).then((unlisten) => unlisteners.push(unlisten));

  logger.info("[TerminalListeners] Terminal event listeners set up");

  // Return cleanup function
  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}
