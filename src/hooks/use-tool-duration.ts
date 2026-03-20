import { useState, useEffect } from "react";
import { useToolState } from "./use-tool-state";

/** Format milliseconds as a compact duration string. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Returns a live-updating duration string for a tool call.
 * Ticks every second while running, returns static value when complete.
 * Returns null if no startedAt is available (legacy tool states).
 */
export function useToolDuration(
  threadId: string,
  toolUseId: string,
): string | null {
  const { status, startedAt, completedAt } = useToolState(threadId, toolUseId);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status !== "running" || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  if (!startedAt) return null;

  if (status === "running") {
    const ms = now - startedAt;
    if (ms < 1000) return null;
    return formatDuration(ms);
  }

  const end = completedAt ?? Date.now();
  const ms = end - startedAt;
  if (ms < 1000) return null;
  return formatDuration(ms);
}

// Exported for testing
export { formatDuration };
