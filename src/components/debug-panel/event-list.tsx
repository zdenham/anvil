import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleStop, Trash2, Search, RotateCcw, ChevronDown, Copy, Check } from "lucide-react";
import { useEventDebuggerStore, type CapturedEvent } from "@/stores/event-debugger-store";
import { ReplayControls } from "@/components/debug-panel/replay-controls";
import { cn } from "@/lib/utils";

// ============================================================================
// Constants
// ============================================================================

const EVENT_TYPES = [
  "thread_action", "stream_delta", "event", "heartbeat",
  "state", "state_event", "optimistic_stream",
  "drain", "log", "network", "register",
] as const;

const TYPE_BADGE_STYLES: Record<string, string> = {
  thread_action: "bg-purple-500/20 text-purple-400",
  stream_delta: "bg-cyan-500/20 text-cyan-400",
  event: "bg-green-500/20 text-green-400",
  heartbeat: "bg-surface-500/20 text-surface-400",
  state: "bg-blue-500/20 text-blue-400",
  state_event: "bg-blue-500/20 text-blue-300",
  optimistic_stream: "bg-cyan-500/20 text-cyan-300",
  drain: "bg-orange-500/20 text-orange-400",
  log: "bg-yellow-500/20 text-yellow-400",
  network: "bg-pink-500/20 text-pink-400",
  register: "bg-teal-500/20 text-teal-400",
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

function formatDelta(deltaMs: number): string {
  if (deltaMs < 1000) return `+${Math.round(deltaMs)}ms`;
  return `+${(deltaMs / 1000).toFixed(1)}s`;
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
  delta,
  replayIndex,
  currentReplayIndex,
}: {
  event: CapturedEvent;
  isSelected: boolean;
  onSelect: (id: number) => void;
  delta: string | null;
  replayIndex: number;
  currentReplayIndex: number;
}) {
  const isCurrentReplay = replayIndex === currentReplayIndex - 1;
  const isFuture = currentReplayIndex > 0 && replayIndex >= currentReplayIndex;
  const displayTs = event.emittedAt ?? event.timestamp;
  const [copied, setCopied] = useState(false);

  const handleCopyEvent = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const json = JSON.stringify(event, null, 2);
      navigator.clipboard.writeText(json).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [event],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(event.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(event.id); }}
      className={cn(
        "group flex items-center gap-2 px-2 py-1 w-full text-left text-xs font-mono cursor-pointer",
        "hover:bg-surface-800 transition-colors border-b border-surface-800/50",
        isSelected && "bg-surface-800 border-l-2 border-l-accent-500",
        isCurrentReplay && "bg-accent-500/10 border-l-2 border-l-accent-400",
        isFuture && "opacity-40",
      )}
    >
      <span className="text-surface-500 flex-shrink-0">
        {delta ?? formatTimestamp(displayTs)}
      </span>
      <TypeBadge type={event.type} />
      <span className="text-surface-200 truncate">{event.name ?? "-"}</span>
      <span className="text-surface-500 flex-shrink-0">{shortThreadId(event.threadId)}</span>
      {event.source && (
        <span className="text-surface-600 truncate text-[10px]">{event.source}</span>
      )}
      <button
        onClick={handleCopyEvent}
        className={cn(
          "ml-auto flex-shrink-0 p-0.5 rounded transition-colors",
          copied
            ? "text-green-400"
            : "text-surface-600 opacity-0 group-hover:opacity-100 hover:text-surface-200",
        )}
        title="Copy event JSON"
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
      </button>
    </div>
  );
}

// ============================================================================
// Filter Bar
// ============================================================================

function FilterBar() {
  const filters = useEventDebuggerStore((s) => s.filters);
  const setFilter = useEventDebuggerStore((s) => s.setFilter);
  const allEvents = useEventDebuggerStore((s) => s.events);

  const threadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of allEvents) {
      if (e.threadId) ids.add(e.threadId);
    }
    return Array.from(ids);
  }, [allEvents]);

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

  const handleThreadChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setFilter("threadId", e.target.value || null);
    },
    [setFilter],
  );

  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!typeDropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTypeDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [typeDropdownOpen]);

  const activeTypeCount = filters.types.size;
  const typeLabel = activeTypeCount === 0 ? "All types" : `${activeTypeCount} type${activeTypeCount > 1 ? "s" : ""}`;

  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-surface-800 flex-shrink-0">
      <Search size={12} className="text-surface-500 flex-shrink-0" />
      <input
        type="text"
        placeholder="Filter events..."
        value={filters.search}
        onChange={handleSearchChange}
        className="flex-1 bg-transparent text-xs text-surface-200 placeholder:text-surface-600 outline-none min-w-0"
      />
      <select
        value={filters.threadId ?? ""}
        onChange={handleThreadChange}
        className="bg-surface-800 text-xs text-surface-300 rounded px-1.5 py-0.5 outline-none border border-surface-700 flex-shrink-0"
      >
        <option value="">All threads</option>
        {threadIds.map((id) => (
          <option key={id} value={id}>{shortThreadId(id)}</option>
        ))}
      </select>
      <div ref={dropdownRef} className="relative flex-shrink-0">
        <button
          onClick={() => setTypeDropdownOpen((o) => !o)}
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors",
            activeTypeCount > 0
              ? "bg-accent-500/10 text-accent-400 border-accent-500/30"
              : "bg-surface-800 text-surface-300 border-surface-700",
          )}
        >
          {typeLabel}
          <ChevronDown size={10} className={cn("transition-transform", typeDropdownOpen && "rotate-180")} />
        </button>
        {typeDropdownOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-surface-800 border border-surface-700 rounded shadow-lg py-1 min-w-[140px]">
            {EVENT_TYPES.map((type) => {
              const isActive = filters.types.size === 0 || filters.types.has(type);
              return (
                <button
                  key={type}
                  onClick={() => handleTypeToggle(type)}
                  className="flex items-center gap-2 w-full px-2 py-1 text-left text-[10px] hover:bg-surface-700 transition-colors"
                >
                  <span className={cn(
                    "w-3 h-3 rounded-sm border flex items-center justify-center flex-shrink-0",
                    isActive ? "bg-accent-500 border-accent-500" : "border-surface-500",
                  )}>
                    {isActive && <span className="text-white text-[8px]">✓</span>}
                  </span>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded",
                    TYPE_BADGE_STYLES[type],
                  )}>
                    {type}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Clear State Button
// ============================================================================

function ClearStateButton({ threadId }: { threadId: string }) {
  const handleClear = useCallback(async () => {
    const { clearThreadStateForReplay } = await import("@/lib/replay-utils");
    clearThreadStateForReplay(threadId);
  }, [threadId]);

  return (
    <button
      onClick={handleClear}
      className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
      title="Clear thread runtime state for replay"
    >
      <RotateCcw size={10} />
      Clear State
    </button>
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
  const replayIndex = useEventDebuggerStore((s) => s.replayIndex);
  const replayState = useEventDebuggerStore((s) => s.replayState);
  const [copied, setCopied] = useState(false);

  const events = useMemo(() => filteredEventsFn(), [allEvents, filters]);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Pre-compute deltas for thread-filtered view
  const deltas = useMemo(() => {
    if (!filters.threadId) return null;
    const result: (string | null)[] = [null];
    for (let i = 1; i < events.length; i++) {
      const prevTs = events[i - 1].emittedAt ?? events[i - 1].timestamp;
      const currTs = events[i].emittedAt ?? events[i].timestamp;
      result.push(formatDelta(currTs - prevTs));
    }
    return result;
  }, [events, filters.threadId]);

  useEffect(() => {
    if (shouldAutoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events.length]);

  const handleCopyAll = useCallback(() => {
    const json = JSON.stringify(events, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [events]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    shouldAutoScroll.current = atBottom;
  }, []);

  const showReplayControls = !!filters.threadId && events.length > 0;

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
        <button
          onClick={handleCopyAll}
          disabled={events.length === 0}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
            events.length === 0
              ? "text-surface-600 cursor-not-allowed"
              : "text-surface-400 hover:text-surface-200 hover:bg-surface-800",
          )}
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? "Copied" : "Copy JSON"}
        </button>
        {filters.threadId && (
          <ClearStateButton threadId={filters.threadId} />
        )}
        <span className="text-[10px] text-surface-500 ml-auto">
          {events.length} events
        </span>
      </div>

      <FilterBar />
      {showReplayControls && <ReplayControls eventCount={events.length} />}

      {/* Event list */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-auto min-h-0">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-surface-500">
            {isCapturing ? "Waiting for events..." : "Click Record to start capturing"}
          </div>
        ) : (
          events.map((event, idx) => (
            <EventRow
              key={event.id}
              event={event}
              isSelected={selectedEventId === event.id}
              onSelect={selectEvent}
              delta={deltas?.[idx] ?? null}
              replayIndex={idx}
              currentReplayIndex={replayState !== "idle" ? replayIndex : -1}
            />
          ))
        )}
      </div>
    </div>
  );
}
