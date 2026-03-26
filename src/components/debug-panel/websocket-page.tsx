import { useEffect, useCallback, useState } from "react";
import { Heart, Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useWebSocketDebuggerStore } from "@/stores/websocket-debugger";
import { cn } from "@/lib/utils";

// ============================================================================
// Status dot color mapping
// ============================================================================

const STATUS_COLORS = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500",
  disconnected: "bg-red-500",
  error: "bg-red-500",
} as const;

// ============================================================================
// Token display with copy
// ============================================================================

function TokenBadge({ masked, full }: { masked: string | null; full: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!full) return;
    navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [full]);

  if (!masked) return <span className="text-surface-500 text-xs">no token</span>;

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-surface-300 hover:text-surface-100 font-mono transition-colors"
      title="Copy auth token"
    >
      {masked}
      {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
    </button>
  );
}

// ============================================================================
// Endpoint result display
// ============================================================================

function EndpointResultCard({ name, result }: {
  name: string;
  result: { response: unknown; status: number; at: number };
}) {
  const [expanded, setExpanded] = useState(true);
  const time = new Date(result.at).toLocaleTimeString();
  const isError = result.status === 0;

  return (
    <div className="border border-surface-700 rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-surface-800 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium text-surface-200">{name}</span>
        <span className={cn("ml-auto font-mono", isError ? "text-red-400" : "text-green-400")}>
          {isError ? "ERR" : result.status}
        </span>
        <span className="text-surface-500">{time}</span>
      </button>
      {expanded && (
        <pre className="px-3 py-2 text-xs text-surface-300 font-mono overflow-auto border-t border-surface-700 max-h-48">
          {JSON.stringify(result.response, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ============================================================================
// Main page
// ============================================================================

export function WebSocketPage() {
  const store = useWebSocketDebuggerStore();

  useEffect(() => {
    store.refresh();
    const interval = setInterval(() => store.refresh(), 2000);
    return () => clearInterval(interval);
  }, []);

  const handleHealthCheck = useCallback(() => {
    store.checkHealth();
  }, []);

  const maskedToken = store.getMaskedToken();
  const resultEntries = Object.entries(store.endpointResults);

  return (
    <div className="flex flex-col h-full min-h-0 p-3 gap-3">
      {/* Status bar */}
      <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", STATUS_COLORS[store.connectionStatus])} />
          <span className="text-xs text-surface-300 font-mono">
            ws://localhost:{store.port ?? "—"}/ws
          </span>
        </div>

        {store.appSuffix && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-800 text-surface-300 font-mono">
            {store.appSuffix}
          </span>
        )}

        <TokenBadge masked={maskedToken} full={store.authToken} />

        <div className="flex-1" />

        <button
          onClick={handleHealthCheck}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-surface-800 hover:bg-surface-700 text-surface-200 transition-colors"
        >
          <Heart size={12} />
          Check Health
        </button>
      </div>

      {/* Endpoint results */}
      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-2">
        {resultEntries.length === 0 && (
          <div className="flex items-center justify-center h-full text-surface-500 text-xs">
            Hit &quot;Check Health&quot; to ping the sidecar process
          </div>
        )}
        {resultEntries.map(([name, result]) => (
          <EndpointResultCard key={name} name={name} result={result} />
        ))}
      </div>
    </div>
  );
}
