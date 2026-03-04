import { useCallback, useEffect, useMemo, useRef } from "react";
import { Circle, CircleStop, Trash2, Search } from "lucide-react";
import { useEventDebuggerStore, type CapturedEvent } from "@/stores/event-debugger-store";
import { cn } from "@/lib/utils";

// ============================================================================
// Constants
// ============================================================================

const EVENT_TYPES = ["state", "event", "drain", "heartbeat", "log"] as const;

const TYPE_BADGE_STYLES: Record<string, string> = {
  state: "bg-blue-500/20 text-blue-400",
  event: "bg-green-500/20 text-green-400",
  drain: "bg-orange-500/20 text-orange-400",
  heartbeat: "bg-surface-500/20 text-surface-400",
  log: "bg-yellow-500/20 text-yellow-400",
};

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function shortThreadId(threadId: string): string {
  return threadId.slice(0, 8);
}

// ============================================================================
// Sub-components
// ============================================================================

function TypeBadge({ type }: { type: string }) {
  const style = TYPE_BADGE_STYLES[type] ?? "bg-surface-500/20 text-surface-400";
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", style)}>
      {type}
    </span>
  );
}

function EventRow({
  event,
  isSelected,
  onSelect,
}: {
  event: CapturedEvent;
  isSelected: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      onClick={() => onSelect(event.id)}
      className={cn(
        "flex items-center gap-2 px-2 py-1 w-full text-left text-xs font-mono",
        "hover:bg-surface-800 transition-colors border-b border-surface-800/50",
        isSelected && "bg-surface-800 border-l-2 border-l-accent-500",
      )}
    >
      <span className="text-surface-500 flex-shrink-0">{formatTimestamp(event.timestamp)}</span>
      <TypeBadge type={event.type} />
      <span className="text-surface-200 truncate">{event.name ?? "-"}</span>
      <span className="text-surface-500 flex-shrink-0">{shortThreadId(event.threadId)}</span>
      {event.source && (
        <span className="text-surface-600 truncate text-[10px]">{event.source}</span>
      )}
    </button>
  );
}

// ============================================================================
// Filter Bar
// ============================================================================

function FilterBar() {
  const filters = useEventDebuggerStore((s) => s.filters);
  const setFilter = useEventDebuggerStore((s) => s.setFilter);

  const handleTypeToggle = useCallback(
    (type: string) => {
      const next = new Set(filters.types);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      setFilter("types", next);
    },
    [filters.types, setFilter],
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter("search", e.target.value);
    },
    [setFilter],
  );

  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-surface-800 flex-shrink-0">
      <Search size={12} className="text-surface-500 flex-shrink-0" />
      <input
        type="text"
        placeholder="Filter events..."
        value={filters.search}
        onChange={handleSearchChange}
        className="flex-1 bg-transparent text-xs text-surface-200 placeholder:text-surface-600 outline-none"
      />
      <div className="flex items-center gap-1 flex-shrink-0">
        {EVENT_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => handleTypeToggle(type)}
            className={cn(
              "px-1.5 py-0.5 rounded text-[10px] transition-colors",
              filters.types.size === 0 || filters.types.has(type)
                ? TYPE_BADGE_STYLES[type]
                : "bg-surface-800 text-surface-600",
            )}
          >
            {type}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function EventList() {
  const isCapturing = useEventDebuggerStore((s) => s.isCapturing);
  const toggleCapture = useEventDebuggerStore((s) => s.toggleCapture);
  const clearEvents = useEventDebuggerStore((s) => s.clearEvents);
  const allEvents = useEventDebuggerStore((s) => s.events);
  const filters = useEventDebuggerStore((s) => s.filters);
  const filteredEventsFn = useEventDebuggerStore((s) => s.filteredEvents);
  const selectedEventId = useEventDebuggerStore((s) => s.selectedEventId);
  const selectEvent = useEventDebuggerStore((s) => s.selectEvent);

  const events = useMemo(() => filteredEventsFn(), [allEvents, filters]);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    if (shouldAutoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events.length]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    shouldAutoScroll.current = atBottom;
  }, []);

  return (
    <div data-testid="event-list" className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-surface-800 flex-shrink-0">
        <button
          onClick={toggleCapture}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
            isCapturing
              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
              : "bg-green-500/20 text-green-400 hover:bg-green-500/30",
          )}
        >
          {isCapturing ? <CircleStop size={10} /> : <Circle size={10} />}
          {isCapturing ? "Stop" : "Record"}
        </button>
        <button
          onClick={clearEvents}
          disabled={events.length === 0}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
            events.length === 0
              ? "text-surface-600 cursor-not-allowed"
              : "text-surface-400 hover:text-surface-200 hover:bg-surface-800",
          )}
        >
          <Trash2 size={10} />
          Clear
        </button>
        <span className="text-[10px] text-surface-500 ml-auto">
          {events.length} events
        </span>
      </div>

      <FilterBar />

      {/* Event list */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-auto min-h-0">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-surface-500">
            {isCapturing ? "Waiting for events..." : "Click Record to start capturing"}
          </div>
        ) : (
          events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              isSelected={selectedEventId === event.id}
              onSelect={selectEvent}
            />
          ))
        )}
      </div>
    </div>
  );
}
