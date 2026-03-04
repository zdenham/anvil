import { useCallback, useEffect, useRef } from "react";
import { Circle, CircleStop, Trash2, Search } from "lucide-react";
import { useNetworkDebuggerStore } from "@/stores/network-debugger";
import type { NetworkRequest } from "@/stores/network-debugger";
import { cn } from "@/lib/utils";

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(ms?: number): string {
  if (ms == null) return "...";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function formatSize(bytes?: number): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function statusColor(status?: number): string {
  if (!status) return "text-surface-500";
  if (status < 300) return "text-green-400";
  if (status < 400) return "text-yellow-400";
  return "text-red-400";
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// ============================================================================
// Sub-components
// ============================================================================

function StatusBadge({ request }: { request: NetworkRequest }) {
  if (request.error) {
    return <span className="text-red-400 text-[10px] font-medium flex-shrink-0">ERR</span>;
  }
  if (request.streaming) {
    return (
      <span className="flex items-center gap-1 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-pulse" />
      </span>
    );
  }
  if (request.status) {
    return (
      <span className={cn("text-[10px] font-medium flex-shrink-0", statusColor(request.status))}>
        {request.status}
      </span>
    );
  }
  return <span className="text-surface-500 text-[10px] flex-shrink-0">...</span>;
}

function RequestRow({
  request,
  isSelected,
  onSelect,
}: {
  request: NetworkRequest;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(request.id)}
      className={cn(
        "flex items-center gap-2 px-2 py-1 w-full text-left text-xs font-mono",
        "hover:bg-surface-800 transition-colors border-b border-surface-800/50",
        isSelected && "bg-surface-800 border-l-2 border-l-accent-500",
      )}
    >
      <StatusBadge request={request} />
      <span className="text-surface-400 flex-shrink-0 uppercase text-[10px]">{request.method}</span>
      <span className="text-surface-200 truncate flex-1">{extractPath(request.url)}</span>
      <span className="text-surface-500 flex-shrink-0 text-[10px]">{formatDuration(request.duration)}</span>
      <span className="text-surface-600 flex-shrink-0 text-[10px]">{formatSize(request.responseSize)}</span>
    </button>
  );
}

// ============================================================================
// Filter Bar
// ============================================================================

function FilterBar() {
  const filter = useNetworkDebuggerStore((s) => s.filter);
  const setFilter = useNetworkDebuggerStore((s) => s.setFilter);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter(e.target.value);
    },
    [setFilter],
  );

  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-surface-800 flex-shrink-0">
      <Search size={12} className="text-surface-500 flex-shrink-0" />
      <input
        type="text"
        placeholder="Filter by URL..."
        value={filter}
        onChange={handleChange}
        className="flex-1 bg-transparent text-xs text-surface-200 placeholder:text-surface-600 outline-none"
      />
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function NetworkRequestList() {
  const isCapturing = useNetworkDebuggerStore((s) => s.isCapturing);
  const toggleCapture = useNetworkDebuggerStore((s) => s.toggleCapture);
  const clearRequests = useNetworkDebuggerStore((s) => s.clearRequests);
  const filteredRequests = useNetworkDebuggerStore((s) => s.filteredRequests);
  const selectedRequestId = useNetworkDebuggerStore((s) => s.selectedRequestId);
  const selectRequest = useNetworkDebuggerStore((s) => s.selectRequest);

  const requests = filteredRequests();
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    if (shouldAutoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [requests.length]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    shouldAutoScroll.current = atBottom;
  }, []);

  return (
    <div className="flex flex-col h-full">
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
          onClick={clearRequests}
          disabled={requests.length === 0}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
            requests.length === 0
              ? "text-surface-600 cursor-not-allowed"
              : "text-surface-400 hover:text-surface-200 hover:bg-surface-800",
          )}
        >
          <Trash2 size={10} />
          Clear
        </button>
        <span className="text-[10px] text-surface-500 ml-auto">
          {requests.length} requests
        </span>
      </div>

      <FilterBar />

      {/* Request list */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-auto min-h-0">
        {requests.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-surface-500">
            {isCapturing ? "Waiting for requests..." : "Click Record to start capturing"}
          </div>
        ) : (
          requests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              isSelected={selectedRequestId === request.id}
              onSelect={selectRequest}
            />
          ))
        )}
      </div>
    </div>
  );
}
