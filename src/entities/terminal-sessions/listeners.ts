/**
 * Terminal session event listeners.
 * Connects Tauri PTY events to the frontend store.
 */
import { listen } from "@tauri-apps/api/event";
import { useTerminalSessionStore } from "./store";
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

  // Listen for terminal output
  listen<TerminalOutputPayload>("terminal:output", (event) => {
    const { id, data } = event.payload;
    const terminalId = String(id);

    // Convert byte array to string
    const text = new TextDecoder().decode(new Uint8Array(data));

    const bufferBefore = useTerminalSessionStore.getState().outputBuffers[terminalId]?.length ?? 0;
    // Append to output buffer for scrollback
    useTerminalSessionStore.getState().appendOutput(terminalId, text);

    logger.debug("[TerminalListeners] Appended output to buffer", {
      terminalId,
      chunkLength: text.length,
      bufferBefore,
      bufferAfter: bufferBefore + text.length,
      textPreview: text.slice(0, 60),
    });
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
