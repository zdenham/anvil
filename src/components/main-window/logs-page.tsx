import { useEffect, useRef, useState, useCallback } from "react";
import { useVirtualList } from "@/hooks/use-virtual-list";
import { logService, useFilteredLogs, useLogStore } from "@/entities/logs";
import type { LogFilter } from "@/entities/logs";
import { LogEntryRow } from "./log-entry";
import { LogsToolbar } from "./logs-toolbar";

/** Height of each log entry row in pixels */
const ROW_HEIGHT = 24;

/** Extra pixels to render above/below viewport */
const OVERSCAN = 240; // ~10 rows

export function LogsPage() {
  const [filter, setFilter] = useState<LogFilter>({ search: "", levels: ["error"] });
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isHydrated = useLogStore((s) => s._hydrated);

  const { filteredLogs, totalCount } = useFilteredLogs(filter);

  const getScrollElement = useCallback(() => scrollRef.current, []);

  const { items, totalHeight, scrollToIndex } = useVirtualList({
    count: filteredLogs.length,
    getScrollElement,
    itemHeight: ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Initialize on first mount (subscribes to live events)
  useEffect(() => {
    if (!isHydrated) {
      logService.init();
    }
  }, [isHydrated]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && filteredLogs.length > 0) {
      requestAnimationFrame(() => {
        scrollToIndex({ index: "LAST", align: "end" });
      });
    }
  }, [filteredLogs.length, autoScroll, scrollToIndex]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  const handleClear = async () => {
    await logService.clear();
  };

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    if (filteredLogs.length > 0) {
      requestAnimationFrame(() => {
        scrollToIndex({ index: "LAST", align: "end" });
      });
    }
  }, [filteredLogs.length, scrollToIndex]);

  return (
    <div className="flex flex-col h-full">
      <LogsToolbar
        filter={filter}
        onFilterChange={setFilter}
        onClear={handleClear}
        filteredCount={filteredLogs.length}
        totalCount={totalCount}
        filteredLogs={filteredLogs}
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
          <div
            style={{
              height: totalHeight,
              width: "100%",
              position: "relative",
            }}
          >
            {items.map((item) => {
              const log = filteredLogs[item.index];
              return (
                <div
                  key={log.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <LogEntryRow log={log} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && filteredLogs.length > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 px-3 py-1.5 text-xs bg-accent-600 text-accent-900 rounded-full shadow-lg hover:bg-accent-500 transition-colors"
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
