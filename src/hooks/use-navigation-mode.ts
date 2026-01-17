import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { eventBus, type NavigationModeEvent } from "@/entities/events";
import { logger } from "@/lib/logger-client";

/**
 * Navigation mode state for the task panel.
 *
 * This hook listens for navigation events from Rust (triggered by Shift+Up/Down hotkeys)
 * and manages the navigation selection state. When Shift is released, the selected task
 * is opened.
 */
export interface UseNavigationModeResult {
  /** Whether navigation mode is currently active */
  isNavigating: boolean;
  /** The currently selected index during navigation */
  selectedIndex: number;
  /** Called when a task should be opened (from nav-open event) */
  onTaskOpen: (index: number) => void;
  /** Set the callback for when a task should be opened */
  setOnTaskOpen: (callback: (index: number) => void) => void;
}

interface UseNavigationModeOptions {
  /** Total number of tasks in the list (for bounds checking) */
  taskCount: number;
  /** Callback when a task should be opened */
  onTaskSelect?: (index: number) => void;
}

/**
 * Hook for managing Command+Tab style navigation in the task panel.
 *
 * Usage:
 * ```tsx
 * const { isNavigating, selectedIndex } = useNavigationMode({
 *   taskCount: tasks.length,
 *   onTaskSelect: (index) => openTask(tasks[index]),
 * });
 * ```
 */
export function useNavigationMode({
  taskCount,
  onTaskSelect,
}: UseNavigationModeOptions): UseNavigationModeResult {
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Use ref for callback to avoid effect dependencies
  const onTaskSelectRef = useRef(onTaskSelect);
  onTaskSelectRef.current = onTaskSelect;

  // Handle navigation events from Rust
  useEffect(() => {
    const handleNavigationEvent = (event: NavigationModeEvent) => {
      logger.debug("[use-navigation-mode] Received event:", event);

      switch (event.type) {
        case "nav-start":
          logger.log("[use-navigation-mode] Navigation mode started");
          setIsNavigating(true);
          setSelectedIndex(0);
          break;

        case "nav-down":
          setSelectedIndex((prev) => {
            const next = prev >= taskCount - 1 ? 0 : prev + 1;
            logger.debug("[use-navigation-mode] nav-down:", prev, "->", next);
            return next;
          });
          break;

        case "nav-up":
          setSelectedIndex((prev) => {
            const next = prev <= 0 ? Math.max(0, taskCount - 1) : prev - 1;
            logger.debug("[use-navigation-mode] nav-up:", prev, "->", next);
            return next;
          });
          break;

        case "nav-open":
          logger.log(
            "[use-navigation-mode] Navigation mode ended, opening task at index:",
            event.selectedIndex
          );
          setIsNavigating(false);
          // Use the selectedIndex from the event (which comes from Rust state)
          // but prefer our local state since it's more accurate for the frontend
          if (onTaskSelectRef.current) {
            // Use current selectedIndex state, not the event's index
            // because our frontend state is more up-to-date
            const currentIndex = selectedIndex;
            onTaskSelectRef.current(currentIndex);
          }
          break;

        case "nav-cancel":
          logger.log("[use-navigation-mode] Navigation cancelled");
          setIsNavigating(false);
          break;

        default:
          logger.warn("[use-navigation-mode] Unknown event type:", event);
      }
    };

    eventBus.on("navigation-mode", handleNavigationEvent);
    return () => {
      eventBus.off("navigation-mode", handleNavigationEvent);
    };
  }, [taskCount, selectedIndex]);

  // Notify Rust when panel loses focus (if in navigation mode)
  const handleBlur = useCallback(() => {
    if (isNavigating) {
      logger.log("[use-navigation-mode] Panel blur during navigation, notifying Rust");
      invoke("navigation_panel_blur").catch((err) => {
        logger.error("[use-navigation-mode] Failed to notify panel blur:", err);
      });
    }
  }, [isNavigating]);

  // Set up blur listener
  useEffect(() => {
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [handleBlur]);

  // External API for manually triggering task open
  const onTaskOpen = useCallback(
    (index: number) => {
      if (onTaskSelectRef.current) {
        onTaskSelectRef.current(index);
      }
    },
    []
  );

  const setOnTaskOpen = useCallback(
    (callback: (index: number) => void) => {
      onTaskSelectRef.current = callback;
    },
    []
  );

  return {
    isNavigating,
    selectedIndex,
    onTaskOpen,
    setOnTaskOpen,
  };
}
