/**
 * TerminalContent
 *
 * xterm.js-based terminal emulator that connects to a Rust PTY backend.
 * Handles:
 * - Terminal rendering and input
 * - Resize handling (fit to container)
 * - PTY output streaming
 * - Scrollback buffer restoration
 *
 * Uses PtyService for all PTY I/O. Works for both terminal sessions and TUI threads.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
// WebGL addon disabled — causes visible flicker on resize due to the WebGL spec
// requiring framebuffer clear on canvas dimension change. xterm.js defers the
// re-render to the next rAF via its internal RenderDebouncer, so there's always
// a 1-frame gap where the cleared canvas is visible. The canvas 2D renderer
// doesn't have this problem because it repaints synchronously.
// Re-enable when xterm.js 6.1.0 stable ships (includes sync render fix, PR #5529).
// import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { listen, type UnlistenFn } from "@/lib/events";
import "@xterm/xterm/css/xterm.css";

import { ptyService } from "@/entities/pty";
import { getOutputBuffer, onOutput } from "@/entities/pty/output-buffer";
import { terminalSessionService } from "@/entities/terminal-sessions";
import { logger } from "@/lib/logger-client";
import type { TerminalContentProps } from "./types";

interface TerminalExitPayload {
  id: number;
}

/**
 * Mort's dark theme for xterm.js.
 * Matches the app's surface colors.
 */
const ANVIL_TERMINAL_THEME = {
  background: "#141514", // surface-900
  foreground: "#e5e5e5", // neutral-200
  cursor: "#e5e5e5",
  cursorAccent: "#141514",
  selectionBackground: "rgba(255, 255, 255, 0.2)",
  black: "#141514",
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
      ptyService.write(terminalId, data).catch((err) => {
        logger.error("[TerminalContent] Failed to write to terminal", {
          terminalId,
          error: err,
        });
      });
    },
    [terminalId]
  );

  // Handle resize - notify the PTY backend synchronously.
  // Skips sub-pixel oscillations (< 3px) caused by devicePixelContentBoxSize
  // rounding errors during layout shifts (xterm.js #4922, fixed in 6.1.0).
  const lastDimsRef = useRef({ width: 0, height: 0 });
  const handleResize = useCallback(
    (force?: boolean) => {
      const container = containerRef.current;
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!container || !terminal || !fitAddon) return;

      const { clientWidth, clientHeight } = container;
      const last = lastDimsRef.current;
      if (
        !force &&
        Math.abs(clientWidth - last.width) < 3 &&
        Math.abs(clientHeight - last.height) < 3
      ) {
        return;
      }
      last.width = clientWidth;
      last.height = clientHeight;

      try {
        fitAddon.fit();
        // Only resize if PTY is registered (alive)
        if (ptyService.getPtyIdOrUndefined(terminalId) === undefined) return;
        ptyService.resize(terminalId, terminal.cols, terminal.rows).catch((err) => {
          logger.debug("[TerminalContent] Failed to resize terminal", {
            terminalId,
            error: err,
          });
        });
      } catch (err) {
        logger.debug("[TerminalContent] Fit failed (container may not be visible)", {
          terminalId,
          error: err,
        });
      }
    },
    [terminalId]
  );

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
      lineHeight: 1.0,
      letterSpacing: 0,
      theme: ANVIL_TERMINAL_THEME,
      allowProposedApi: true,
      scrollback: 10_000,
      rescaleOverlappingGlyphs: true,
      customGlyphs: true,
      drawBoldTextInBrightColors: false,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);

    // WebGL addon intentionally omitted — see import comment above.
    // The canvas 2D renderer is used instead; it's flicker-free on resize and
    // more than fast enough for terminal text rendering.

    terminal.open(containerRef.current);

    // Unicode graphemes — proper emoji, CJK, and compound character width calculation
    const unicodeAddon = new UnicodeGraphemesAddon();
    terminal.loadAddon(unicodeAddon);
    terminal.unicode.activeVersion = "15";

    // Clickable URLs in terminal output
    terminal.loadAddon(new WebLinksAddon());

    // OSC 52 clipboard integration
    terminal.loadAddon(new ClipboardAddon());

    // Shell integration: parse command names from OSC 7727
    terminal.parser.registerOscHandler(7727, (data) => {
      if (data.startsWith("cmd;")) {
        const command = data.slice(4).trim();
        if (command) {
          terminalSessionService.updateLastCommand(terminalId, command);
        }
      }
      return true;
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Fit to container (force bypasses threshold on first fit)
    setTimeout(() => {
      handleResize(true);
    }, 0);

    // Restore scrollback buffer if we have one (only at mount time)
    if (initialBuffer) {
      terminal.write(initialBuffer);
    }

    // Handle user input
    terminal.onData(handleInput);

    // macOS keyboard shortcuts → terminal escape sequences
    // xterm.js doesn't translate these natively; iTerm2/Terminal.app do.
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== "keydown") return true;

      const isMeta = event.metaKey;
      const isAlt = event.altKey;

      if (isMeta && event.key === "ArrowLeft") {
        handleInput("\x01"); // Ctrl+A — beginning of line
        return false;
      }
      if (isMeta && event.key === "ArrowRight") {
        handleInput("\x05"); // Ctrl+E — end of line
        return false;
      }
      if (isMeta && event.key === "Backspace") {
        handleInput("\x15"); // Ctrl+U — kill line backward
        return false;
      }
      if (isAlt && event.key === "ArrowLeft") {
        handleInput("\x1bb"); // ESC+b — word back
        return false;
      }
      if (isAlt && event.key === "ArrowRight") {
        handleInput("\x1bf"); // ESC+f — word forward
        return false;
      }
      if (isAlt && event.key === "Backspace") {
        handleInput("\x17"); // Ctrl+W — delete word back
        return false;
      }

      // Let Cmd+C, Cmd+V, etc. pass through to the webview
      if (isMeta) return false;

      // Terminal consumes this key — stop the DOM event from bubbling to
      // document-level listeners (e.g. Escape closing panels, exiting fullscreen).
      event.stopPropagation();

      return true;
    });

    // Set up resize observer
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
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
      const resolvedId = ptyService.resolveByPtyId(event.payload.id);
      if (resolvedId === terminalId) {
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
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      isInitializedRef.current = false;
    };
  }, [terminalId, handleInput, handleResize, initialBuffer]);

  // Auto-revive dead terminals when this component is displayed.
  // For terminal sessions: uses terminalSessionService.revive()
  // For TUI threads: handled by TuiThreadContent (not here)
  const session = terminalSessionService.get(terminalId);

  useEffect(() => {
    if (session && !session.isAlive && !session.isArchived) {
      terminalSessionService.revive(terminalId).then(() => {
        // Sync PTY dimensions — the mount-time resize skips dead terminals
        handleResize(true);
      }).catch((err) => {
        logger.warn("[TerminalContent] Failed to revive terminal (non-fatal):", err);
      });
    }
  }, [session?.isAlive, session?.isArchived, terminalId, handleResize]);

  // Focus terminal when container is clicked
  const handleClick = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  return (
    <div className="w-full h-full bg-surface-900 p-3" onClick={handleClick}>
      <div
        ref={containerRef}
        data-testid="terminal-content"
        className="w-full h-full bg-[#141514]"
        style={{
          overflow: "hidden",
          contain: "strict",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        }}
      />
    </div>
  );
}
