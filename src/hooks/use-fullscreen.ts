/**
 * useFullscreen Hook
 *
 * Detects when the window is in fullscreen mode on macOS.
 * Used to add extra top padding to avoid the system menu bar
 * appearing when hovering near the top edge of the screen.
 */

import { useState, useEffect } from "react";
import { getCurrentWindow } from "@/lib/browser-stubs";

export function useFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();

    // Check initial state
    appWindow.isFullscreen().then(setIsFullscreen).catch(() => {});

    // Listen for fullscreen changes
    const unlisten = appWindow.onResized(async () => {
      try {
        const fullscreen = await appWindow.isFullscreen();
        setIsFullscreen(fullscreen);
      } catch {
        // Ignore errors
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return isFullscreen;
}
