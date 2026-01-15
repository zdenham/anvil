import { useState, useEffect } from "react";
import { formatRelativeTime } from "@/lib/utils/time-format";

/**
 * Hook that returns auto-updating relative time string.
 * Updates every 30 seconds while component is mounted.
 */
export function useRelativeTime(timestamp: number): string {
  const [relativeTime, setRelativeTime] = useState(() =>
    formatRelativeTime(timestamp)
  );

  useEffect(() => {
    // Update immediately
    setRelativeTime(formatRelativeTime(timestamp));

    // Update every 30 seconds
    const interval = setInterval(() => {
      setRelativeTime(formatRelativeTime(timestamp));
    }, 30000);

    return () => clearInterval(interval);
  }, [timestamp]);

  return relativeTime;
}
