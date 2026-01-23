import React, { useMemo, useEffect, useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, X } from "lucide-react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useThreadLastMessages } from "@/hooks/use-thread-last-messages";
import { eventBus, type NavigationModeEvent } from "@/entities/events";
import { switchToThread, switchToPlan } from "@/lib/hotkey-service";
import { logger } from "@/lib/logger-client";
import { createUnifiedList } from "@/components/inbox/utils";
import { InboxItemRow } from "@/components/inbox/inbox-item";
import { StatusLegend } from "@/components/ui/status-legend";
import { threadService } from "@/entities/threads/service";
import { planService } from "@/entities/plans/service";

/**
 * InboxListWindow is the main component for the inbox-list-panel.
 *
 * This panel is shown during Alt+Down/Up navigation mode and displays
 * the unified inbox list with keyboard navigation support.
 *
 * Navigation lifecycle:
 * 1. nav-start: Panel shown, first item selected
 * 2. nav-down/nav-up: Selection moves through items
 * 3. nav-release: Alt released, open selected item in control panel
 * 4. nav-cancel: Escape pressed or panel blur, hide panel
 */
export function InboxListWindow() {
  // Get threads and plans from stores
  const threads = useThreadStore((s) => s.getAllThreads());
  const plans = usePlanStore((s) => s.getAll());
  const threadLastMessages = useThreadLastMessages(threads);

  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Handle refresh button click
  const handleRefresh = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't interfere with navigation
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      await Promise.all([threadService.hydrate(), planService.hydrate()]);
    } catch (err) {
      logger.error("[InboxListWindow] Refresh failed:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing]);

  // Handle close button click
  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Don't interfere with navigation
    invoke("hide_inbox_list_panel").catch((err) => {
      logger.error("[InboxListWindow] Failed to hide panel:", err);
    });
  }, []);

  // Create unified list sorted by updatedAt
  const items = useMemo(
    () => createUnifiedList(threads, plans, threadLastMessages),
    [threads, plans, threadLastMessages]
  );

  // Track selected index during navigation
  const selectedIndexRef = useRef(0);
  const [selectedIndex, setSelectedIndexState] = useSelectedIndex(0);

  // Keep items in a ref to avoid stale closures in handleItemOpen
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Helper to update both ref and state
  const setSelectedIndex = useCallback((value: number | ((prev: number) => number)) => {
    if (typeof value === "function") {
      setSelectedIndexState((prev) => {
        const newVal = value(prev);
        selectedIndexRef.current = newVal;
        return newVal;
      });
    } else {
      selectedIndexRef.current = value;
      setSelectedIndexState(value);
    }
  }, [setSelectedIndexState]);

  // Handle opening the selected item
  // Frontend owns the index - uses refs to avoid stale closures
  const handleItemOpen = useCallback(() => {
    const currentIndex = selectedIndexRef.current;
    const item = itemsRef.current[currentIndex];

    if (!item) {
      logger.warn("[InboxListWindow] No item at index:", currentIndex);
      return;
    }

    logger.log("[InboxListWindow] Opening item at index:", currentIndex, item.type);

    // Hide this panel first
    invoke("hide_inbox_list_panel").catch((err) => {
      logger.error("[InboxListWindow] Failed to hide panel:", err);
    });

    // Open the selected item in control panel
    if (item.type === "thread") {
      switchToThread(item.data.id);
    } else if (item.type === "plan") {
      switchToPlan(item.data.id);
    }
  }, []);  // No dependencies needed - uses refs

  // Handle navigation events from Rust
  useEffect(() => {
    const handleNavigationEvent = (event: NavigationModeEvent) => {
      logger.debug("[InboxListWindow] Received navigation event:", event);

      switch (event.type) {
        case "nav-start":
          logger.log("[InboxListWindow] Navigation started");
          setSelectedIndex(0);
          break;

        case "nav-down":
          setSelectedIndex((prev) => {
            const next = prev >= items.length - 1 ? 0 : prev + 1;
            logger.debug("[InboxListWindow] nav-down:", prev, "->", next);
            return next;
          });
          break;

        case "nav-up":
          setSelectedIndex((prev) => {
            const next = prev <= 0 ? Math.max(0, items.length - 1) : prev - 1;
            logger.debug("[InboxListWindow] nav-up:", prev, "->", next);
            return next;
          });
          break;

        case "nav-release":
          handleItemOpen();
          break;

        case "nav-cancel":
          logger.log("[InboxListWindow] Navigation cancelled");
          // Panel will be hidden by Rust
          break;
      }
    };

    eventBus.on("navigation-mode", handleNavigationEvent);
    return () => {
      eventBus.off("navigation-mode", handleNavigationEvent);
    };
  }, [items.length, setSelectedIndex, handleItemOpen]);

  // Handle direct click on an item
  const handleItemClick = useCallback((index: number) => {
    setSelectedIndex(index);
    const item = items[index];

    if (!item) return;

    // Hide this panel
    invoke("hide_inbox_list_panel").catch((err) => {
      logger.error("[InboxListWindow] Failed to hide panel:", err);
    });

    // Open the selected item
    if (item.type === "thread") {
      switchToThread(item.data.id);
    } else if (item.type === "plan") {
      switchToPlan(item.data.id);
    }
  }, [items, setSelectedIndex]);

  // Notify Rust when panel loses focus during navigation
  useEffect(() => {
    const handleBlur = () => {
      logger.log("[InboxListWindow] Panel blur, notifying Rust");
      invoke("navigation_panel_blur").catch((err) => {
        logger.error("[InboxListWindow] Failed to notify panel blur:", err);
      });
    };

    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, []);

  // Handle Escape key to cancel navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        invoke("navigation_panel_blur").catch((err) => {
          logger.error("[InboxListWindow] Failed to cancel navigation via panel blur:", err);
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Empty state
  if (items.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-surface-900 rounded-lg overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-surface-500 text-sm">
          No items in inbox
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-surface-900 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-700 flex items-center justify-between">
        <h2 className="text-sm font-medium text-surface-300">Mission Control Panel</h2>
        <div className="flex items-center gap-1">
          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 text-surface-400 hover:text-surface-300 hover:bg-surface-800/50 rounded transition-colors duration-150 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
          </button>
          {/* Close button */}
          <button
            onClick={handleClose}
            className="p-1.5 text-surface-400 hover:text-surface-300 hover:bg-surface-800/50 rounded transition-colors duration-150"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-auto">
        <ul className="space-y-2 px-3 pt-3">
          {items.map((item, index) => (
            <InboxItemRow
              key={`${item.type}-${item.data.id}`}
              item={item}
              isSelected={selectedIndex === index}
              onSelect={() => handleItemClick(index)}
            />
          ))}
        </ul>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-surface-700 text-xs text-surface-500">
        <StatusLegend />
        <span>Release Alt to open, Escape to cancel</span>
      </div>
    </div>
  );
}

/**
 * Simple hook for managing selected index state.
 * Separated for clarity and to avoid issues with useState in callbacks.
 */
function useSelectedIndex(initialValue: number): [number, React.Dispatch<React.SetStateAction<number>>] {
  const [value, setValue] = useState(initialValue);
  return [value, setValue];
}
