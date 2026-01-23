import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { eventBus, type NavigationModeEvent } from "@/entities/events";
import { logger } from "@/lib/logger-client";

/**
 * Navigation mode state for the control panel.
 *
 * This hook listens for navigation events from Rust (triggered by Shift+Up/Down hotkeys)
 * and manages the navigation selection state. When Shift is released, the selected item
 * is opened.
 */
export interface UseNavigationModeResult {
  /** Whether navigation mode is currently active */
  isNavigating: boolean;
  /** The currently selected index during navigation */
  selectedIndex: number;
  /** Called when an item should be opened (from nav-open event) */
  onItemOpen: (index: number) => void;
  /** Set the callback for when an item should be opened */
  setOnItemOpen: (callback: (index: number) => void) => void;
}

interface UseNavigationModeOptions {
  /** Total number of items in the list (for bounds checking) */
  itemCount: number;
  /** Callback when an item should be opened */
  onItemSelect?: (index: number) => void;
}

/**
 * Hook for managing Command+Tab style navigation in the control panel.
 *
 * Usage:
 * ```tsx
 * const { isNavigating, selectedIndex } = useNavigationMode({
 *   itemCount: items.length,
 *   onItemSelect: (index) => openItem(items[index]),
 * });
 * ```
 */
export function useNavigationMode({
  itemCount,
  onItemSelect,
}: UseNavigationModeOptions): UseNavigationModeResult {
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Use ref for callback to avoid effect dependencies
  const onItemSelectRef = useRef(onItemSelect);
  onItemSelectRef.current = onItemSelect;

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
            const next = prev >= itemCount - 1 ? 0 : prev + 1;
            logger.debug("[use-navigation-mode] nav-down:", prev, "->", next);
            return next;
          });
          break;

        case "nav-up":
          setSelectedIndex((prev) => {
            const next = prev <= 0 ? Math.max(0, itemCount - 1) : prev - 1;
            logger.debug("[use-navigation-mode] nav-up:", prev, "->", next);
            return next;
          });
          break;

        case "nav-release":
          logger.log(
            "[use-navigation-mode] Navigation mode ended, opening item at local index:",
            selectedIndex
          );
          setIsNavigating(false);
          // Frontend owns the index - use local state
          if (onItemSelectRef.current) {
            onItemSelectRef.current(selectedIndex);
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
  }, [itemCount, selectedIndex]);

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

  // External API for manually triggering item open
  const onItemOpen = useCallback(
    (index: number) => {
      if (onItemSelectRef.current) {
        onItemSelectRef.current(index);
      }
    },
    []
  );

  const setOnItemOpen = useCallback(
    (callback: (index: number) => void) => {
      onItemSelectRef.current = callback;
    },
    []
  );

  return {
    isNavigating,
    selectedIndex,
    onItemOpen,
    setOnItemOpen,
  };
}
