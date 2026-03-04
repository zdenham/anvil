/**
 * Terminal session event listeners.
 * Connects Tauri PTY events to the frontend store.
 */
import { listen } from "@/lib/events";
import { useTerminalSessionStore } from "./store";
import { decodeOutput, appendOutput } from "./output-buffer";
import { logger } from "@/lib/logger-client";

interface TerminalOutputPayload {
  id: number;
  data: number[];
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
    const text = decodeOutput(data);
    appendOutput(String(id), text);
  }).then((unlisten) => unlisteners.push(unlisten));

  // Listen for terminal exit (process ended)
  listen<TerminalExitPayload>("terminal:exit", (event) => {
    const terminalId = String(event.payload.id);
    logger.info("[TerminalListeners] Terminal exited", { terminalId });

    useTerminalSessionStore.getState().markExited(terminalId);
  }).then((unlisten) => unlisteners.push(unlisten));

  // Listen for terminal killed (archived)
  listen<TerminalKilledPayload>("terminal:killed", (event) => {
    const terminalId = String(event.payload.id);
    logger.info("[TerminalListeners] Terminal killed", { terminalId });

    useTerminalSessionStore.getState().removeSession(terminalId);
  }).then((unlisten) => unlisteners.push(unlisten));

  logger.info("[TerminalListeners] Terminal event listeners set up");

  // Return cleanup function
  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}
