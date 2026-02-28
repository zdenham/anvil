import { useMemo } from "react";
import { useLogStore } from "./store";
import type { LogFilter } from "./types";

export function useFilteredLogs(filter: LogFilter) {
  // Subscribe to logCount (primitive) instead of logs (array ref) to avoid
  // re-renders on every mutation. The array is mutated in place.
  const logCount = useLogStore((s) => s.logCount);

  const filteredLogs = useMemo(() => {
    const logs = useLogStore.getState().logs;
    return logs.filter((log) => {
      // Level filter
      if (filter.levels.length > 0 && !filter.levels.includes(log.level)) {
        return false;
      }
      // Search filter (case-insensitive, searches message and target)
      if (filter.search) {
        const search = filter.search.toLowerCase();
        if (
          !log.message.toLowerCase().includes(search) &&
          !log.target.toLowerCase().includes(search)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [logCount, filter.levels, filter.search]);

  return { filteredLogs, totalCount: logCount };
}

export { useLogStore } from "./store";
export { logService } from "./service";
export * from "./types";
