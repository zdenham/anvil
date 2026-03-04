/**
 * TerminalContent
 *
 * xterm.js-based terminal emulator that connects to a Rust PTY backend.
 * Handles:
 * - Terminal rendering and input
 * - Resize handling (fit to container)
 * - PTY output streaming
 * - Scrollback buffer restoration
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { listen, type UnlistenFn } from "@/lib/events";
import "@xterm/xterm/css/xterm.css";

import { terminalSessionService } from "@/entities/terminal-sessions";
import { useTerminalSessionStore } from "@/entities/terminal-sessions";
import { getOutputBuffer, onOutput } from "@/entities/terminal-sessions/output-buffer";
import { logger } from "@/lib/logger-client";
import type { TerminalContentProps } from "./types";

interface TerminalExitPayload {
  id: number;
}

/**
 * Mort's dark theme for xterm.js.
 * Matches the app's surface colors.
 */
const MORT_TERMINAL_THEME = {
  background: "#0f0f0f", // surface-950
  foreground: "#e5e5e5", // neutral-200
  cursor: "#e5e5e5",
  cursorAccent: "#0f0f0f",
  selectionBackground: "rgba(255, 255, 255, 0.2)",
  black: "#0f0f0f",
  red: "#f87171", // red-400
  green: "#4ade80", // green-400
  yellow: "#facc15", // yellow-400
  blue: "#60a5fa", // blue-400
  magenta: "#c084fc", // purple-400
  cyan: "#22d3ee", // cyan-400
  white: "#e5e5e5",
  brightBlack: "#525252", // neutral-600
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
};

export function TerminalContent({
  terminalId,
  onClose: _onClose,
  onArchive: _onArchive,
}: TerminalContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isInitializedRef = useRef(false);

  // Capture initial buffer value once for reconnection scenarios.
  const [initialBuffer] = useState(() => getOutputBuffer(terminalId));

  // Write to PTY when user types
  const handleInput = useCallback(
    (data: string) => {
      terminalSessionService.write(terminalId, data).catch((err) => {
        logger.error("[TerminalContent] Failed to write to terminal", {
          terminalId,
          error: err,
        });
      });
    },
    [terminalId]
  );

  // Handle resize - notify the PTY backend with debounce to avoid hammering during drag
  const resizeTimeoutRef = useRef<number | null>(null);
  const handleResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    // Clear any pending resize
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    // Debounce the actual resize by 100ms
    resizeTimeoutRef.current = window.setTimeout(() => {
      try {
        fitAddon.fit();
        const session = useTerminalSessionStore.getState().sessions[terminalId];
        if (!session?.isAlive) return;
        terminalSessionService
          .resize(terminalId, terminal.cols, terminal.rows)
          .catch((err) => {
            logger.debug("[TerminalContent] Failed to resize terminal", {
              terminalId,
              error: err,
            });
          });
      } catch (err) {
        // fitAddon.fit() can throw if container has no dimensions
        logger.debug("[TerminalContent] Fit failed (container may not be visible)", {
          terminalId,
          error: err,
        });
      }
    }, 100);
  }, [terminalId]);

  // Initialize xterm.js
  useEffect(() => {
    if (!containerRef.current || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const instanceId = Math.random().toString(36).slice(2, 8);
    logger.info("[TerminalContent] Initializing terminal", {
      terminalId,
      instanceId,
      hasInitialBuffer: !!initialBuffer,
      initialBufferLength: initialBuffer.length,
    });

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: MORT_TERMINAL_THEME,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);

    // Try WebGL addon (falls back to canvas if unavailable)
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch (err) {
      logger.warn("[TerminalContent] WebGL addon failed to load, using canvas", {
        error: err,
      });
    }

    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Fit to container
    setTimeout(() => {
      handleResize();
    }, 0);

    // Restore scrollback buffer if we have one (only at mount time)
    if (initialBuffer) {
      terminal.write(initialBuffer);
    }

    // Handle user input
    terminal.onData(handleInput);

    // Set up resize observer
    const resizeObserver = new ResizeObserver(() => {
      // Debounce resize handling
      requestAnimationFrame(handleResize);
    });
    resizeObserver.observe(containerRef.current);

    // Subscribe to decoded output from the shared output-buffer module.
    // No Tauri listener, no TextDecoder, no Uint8Array — already decoded in listeners.ts.
    let disposed = false;
    const unsubOutput = onOutput(terminalId, (text) => {
      if (disposed) return;
      terminal.write(text);
    });

    // Listen for PTY exit
    let exitUnlisten: UnlistenFn | undefined;
    listen<TerminalExitPayload>("terminal:exit", (event) => {
      if (String(event.payload.id) === terminalId) {
        logger.info("[TerminalContent] Terminal exit event received", {
          terminalId,
          instanceId,
          disposed,
        });
        if (!disposed) {
          terminal.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
        }
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      exitUnlisten = unlisten;
    });

    // Focus terminal
    terminal.focus();

    // Cleanup
    return () => {
      disposed = true;
      logger.info("[TerminalContent] Disposing terminal", {
        terminalId,
        instanceId,
        hadExitUnlisten: !!exitUnlisten,
      });
      unsubOutput();
      exitUnlisten?.();
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      isInitializedRef.current = false;
    };
  }, [terminalId, handleInput, handleResize, initialBuffer]);

  // Focus terminal when container is clicked
  const handleClick = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="terminal-content"
      className="w-full h-full bg-surface-950 p-2"
      onClick={handleClick}
      style={{ overflow: "hidden" }}
    />
  );
}
