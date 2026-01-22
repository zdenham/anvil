import { useState, useEffect, useRef } from "react";
import { panelCommands } from "@/lib/tauri-commands";

/**
 * Hook to check if any nspanel is currently visible.
 * Returns true if any panel (spotlight, clipboard, task, error, control-panel, tasks-list) is visible.
 */
export function usePanelVisibility() {
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const intervalRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Check visibility immediately
    const checkVisibility = async () => {
      try {
        const visible = await panelCommands.isAnyPanelVisible();
        setIsVisible(visible);
      } catch (error) {
        console.error("Failed to check panel visibility:", error);
        setIsVisible(false);
      }
    };

    // Initial check
    checkVisibility();

    // Poll for visibility changes every 100ms
    // This is needed because panels can be shown/hidden through global shortcuts
    // or other external actions that don't emit events to React
    intervalRef.current = setInterval(checkVisibility, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return isVisible;
}

/**
 * Hook to check if a specific panel is currently visible.
 * Returns true if the specified panel is visible, false otherwise.
 *
 * @param panelLabel The panel label to check (e.g., "control-panel", "task", "spotlight")
 */
export function useSpecificPanelVisibility(panelLabel: string) {
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const intervalRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Check visibility immediately
    const checkVisibility = async () => {
      try {
        const visible = await panelCommands.isPanelVisible(panelLabel);
        setIsVisible(visible);
      } catch (error) {
        console.error(`Failed to check ${panelLabel} panel visibility:`, error);
        setIsVisible(false);
      }
    };

    // Initial check
    checkVisibility();

    // Poll for visibility changes every 100ms
    // This is needed because panels can be shown/hidden through global shortcuts
    // or other external actions that don't emit events to React
    intervalRef.current = setInterval(checkVisibility, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [panelLabel]);

  return isVisible;
}