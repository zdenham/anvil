/**
 * useWindowDrag Hook
 *
 * Provides reusable window drag functionality for Tauri panels.
 *
 * Behavior:
 * - When window is unfocused: click anywhere to drag (quick repositioning)
 * - When window is focused: drag only from header area (enables text selection in content)
 * - Double-click closes the panel (optional)
 * - Pins the panel on drag so it stays visible after blur
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@/lib/invoke";
import { getCurrentWindow } from "@/lib/browser-stubs";
import { logger } from "@/lib/logger-client";

const INTERACTIVE_SELECTOR = 'button, input, textarea, a, [role="button"], [contenteditable="true"]';

export interface UseWindowDragOptions {
  /** Tauri command to pin the panel (default: "pin_control_panel") */
  pinCommand?: string;
  /** Whether double-click should close the panel (default: true) */
  enableDoubleClickClose?: boolean;
  /** Tauri command to hide/close the panel (default: "hide_control_panel") */
  hideCommand?: string;
}

export interface UseWindowDragResult {
  /** Whether the window is currently focused */
  isWindowFocused: boolean;
  /** Whether a drag operation is in progress */
  isDragging: boolean;
  /** Props to spread onto the draggable container element */
  dragProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    onDoubleClick?: (e: React.MouseEvent) => void;
    className: string;
  };
}

export function useWindowDrag(options: UseWindowDragOptions = {}): UseWindowDragResult {
  const {
    pinCommand = "pin_control_panel",
    enableDoubleClickClose = true,
    hideCommand = "hide_control_panel",
  } = options;

  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const [isDragging, setIsDragging] = useState(false);

  // Track window focus state
  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const handleMouseDown = useCallback(
    async (e: React.MouseEvent) => {
      // Only drag on primary (left) mouse button
      if (e.button !== 0) return;

      // Check if clicking on an interactive element - if so, don't start dragging
      const target = e.target as HTMLElement;
      if (target.closest(INTERACTIVE_SELECTOR)) return;

      // When focused, only allow dragging from the header area
      // This enables text selection in the content area when the panel is focused
      if (isWindowFocused) {
        const isInHeader = target.closest('[data-drag-region="header"]');
        if (!isInHeader) return; // Allow text selection in content
      }

      // Pin the panel - it stays pinned until explicitly hidden
      // This allows users to position the panel and have it stay visible on blur
      if (pinCommand) {
        try {
          await invoke(pinCommand);
          logger.debug(`[useWindowDrag] Panel pinned via ${pinCommand}`);
        } catch (err) {
          logger.error(`[useWindowDrag] Failed to pin panel:`, err);
        }
      }

      // Set dragging state to disable text selection during drag
      setIsDragging(true);

      // Start window drag via Tauri API
      getCurrentWindow()
        .startDragging()
        .catch((err) => {
          logger.error("[useWindowDrag] startDragging failed:", err);
        });

      // Listen for mouseup to know when drag ended
      const handleMouseUp = () => {
        window.removeEventListener("mouseup", handleMouseUp);
        setIsDragging(false);
      };
      window.addEventListener("mouseup", handleMouseUp);
    },
    [isWindowFocused, pinCommand]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(INTERACTIVE_SELECTOR) && hideCommand) {
        invoke(hideCommand);
      }
    },
    [hideCommand]
  );

  return {
    isWindowFocused,
    isDragging,
    dragProps: {
      onMouseDown: handleMouseDown,
      ...(enableDoubleClickClose && { onDoubleClick: handleDoubleClick }),
      className: isDragging ? "is-dragging" : "",
    },
  };
}
