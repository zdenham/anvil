import { useMemo } from "react";
import { useLogStore } from "./store";
import type { LogFilter } from "./types";

export function useFilteredLogs(filter: LogFilter) {
  const logs = useLogStore((s) => s.logs);

  const filteredLogs = useMemo(() => {
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
  }, [logs, filter.levels, filter.search]);

  return { filteredLogs, totalCount: logs.length };
}

export { useLogStore } from "./store";
export { logService } from "./service";
export * from "./types";
