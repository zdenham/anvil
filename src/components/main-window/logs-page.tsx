import { useEffect, useRef, useState } from "react";
import { logService, useFilteredLogs, useLogStore } from "@/entities/logs";
import type { LogFilter } from "@/entities/logs";
import { LogEntryRow } from "./log-entry";
import { LogsToolbar } from "./logs-toolbar";

export function LogsPage() {
  const [filter, setFilter] = useState<LogFilter>({ search: "", levels: ["error"] });
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isHydrated = useLogStore((s) => s._hydrated);

  const { filteredLogs, totalCount } = useFilteredLogs(filter);

  // Initialize on first mount (subscribes to live events)
  useEffect(() => {
    if (!isHydrated) {
      logService.init();
    }
  }, [isHydrated]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs.length, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const handleClear = async () => {
    await logService.clear();
  };

  return (
    <div className="flex flex-col h-full">
      <LogsToolbar
        filter={filter}
        onFilterChange={setFilter}
        onClear={handleClear}
        filteredCount={filteredLogs.length}
        totalCount={totalCount}
      />

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-surface-950"
      >
        {!isHydrated ? (
          <div className="flex items-center justify-center h-full text-surface-500">
            Loading logs...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-surface-500">
            {totalCount === 0 ? "No logs yet" : "No matching logs"}
          </div>
        ) : (
          <div className="py-1">
            {filteredLogs.map((log) => (
              <LogEntryRow key={log.id} log={log} />
            ))}
          </div>
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && filteredLogs.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-4 right-4 px-3 py-1.5 text-xs bg-accent-600 text-accent-900 rounded-full shadow-lg hover:bg-accent-500 transition-colors"
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
