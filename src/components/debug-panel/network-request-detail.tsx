import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Copy, Check } from "lucide-react";
import { useNetworkDebuggerStore } from "@/stores/network-debugger";
import { buildCurlCommand } from "@/lib/build-curl-command";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

type DetailTab = "headers" | "body" | "timing";

// ============================================================================
// Sub-components
// ============================================================================

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2 py-0.5 text-[10px] rounded transition-colors",
        active
          ? "bg-surface-700 text-surface-200"
          : "text-surface-500 hover:text-surface-300",
      )}
    >
      {label}
    </button>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      logger.warn("[network-detail] Failed to copy to clipboard", err);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : label}
    </button>
  );
}

function HeadersTable({ headers, label }: { headers: Record<string, string>; label: string }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return (
      <div className="text-[10px] text-surface-600 italic">No {label.toLowerCase()}</div>
    );
  }

  return (
    <div>
      <h4 className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-1">
        {label}
      </h4>
      <div className="border border-surface-800 rounded overflow-hidden">
        {entries.map(([key, value]) => (
          <div key={key} className="flex text-[10px] font-mono border-b border-surface-800/50 last:border-b-0">
            <span className="px-2 py-0.5 text-surface-300 w-[40%] flex-shrink-0 truncate">{key}</span>
            <span className="px-2 py-0.5 text-surface-400 truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Tab Content
// ============================================================================

function HeadersTab() {
  const selectedRequestId = useNetworkDebuggerStore((s) => s.selectedRequestId);
  const requests = useNetworkDebuggerStore((s) => s.requests);
  const request = selectedRequestId ? requests.get(selectedRequestId) : null;

  if (!request) return null;

  return (
    <div className="space-y-3">
      <HeadersTable headers={request.requestHeaders} label="Request Headers" />
      <HeadersTable headers={request.responseHeaders ?? {}} label="Response Headers" />
    </div>
  );
}

function BodyTab() {
  const selectedRequestId = useNetworkDebuggerStore((s) => s.selectedRequestId);
  const requests = useNetworkDebuggerStore((s) => s.requests);
  const request = selectedRequestId ? requests.get(selectedRequestId) : null;
  const bodyRef = useRef<HTMLPreElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    if (request?.streaming && shouldAutoScroll.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [request?.responseBody, request?.streaming]);

  if (!request) return null;

  const formatBody = (body: string | null): string => {
    if (!body) return "(empty)";
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  };

  const handleScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    shouldAutoScroll.current = atBottom;
  };

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-1">
          Request Body
        </h4>
        <pre className="px-2 py-1 text-[10px] font-mono text-surface-300 overflow-auto max-h-40 border border-surface-800 rounded">
          {formatBody(request.requestBody)}
        </pre>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h4 className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">
            Response Body
          </h4>
          {request.streaming && (
            <span className="flex items-center gap-1 text-[10px] text-surface-500">
              <span className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-pulse" />
              Streaming ({request.chunks} chunks, {request.responseBody.length} bytes)
            </span>
          )}
        </div>
        <pre
          ref={bodyRef}
          onScroll={handleScroll}
          className="px-2 py-1 text-[10px] font-mono text-surface-300 overflow-auto max-h-60 border border-surface-800 rounded"
        >
          {formatBody(request.responseBody || null)}
        </pre>
      </div>
    </div>
  );
}

function TimingTab() {
  const selectedRequestId = useNetworkDebuggerStore((s) => s.selectedRequestId);
  const requests = useNetworkDebuggerStore((s) => s.requests);
  const request = selectedRequestId ? requests.get(selectedRequestId) : null;

  if (!request) return null;

  const formatDuration = (ms?: number): string => {
    if (ms == null) return "pending";
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  };

  const formatSize = (bytes?: number): string => {
    if (bytes == null) return "-";
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const rows = [
    { label: "Started", value: new Date(request.timestamp).toISOString() },
    { label: "Duration", value: formatDuration(request.duration) },
    { label: "Status", value: request.status ? `${request.status} ${request.statusText ?? ""}` : "pending" },
    { label: "Chunks", value: String(request.chunks) },
    { label: "Request Size", value: formatSize(request.bodySize) },
    { label: "Response Size", value: formatSize(request.responseSize) },
  ];

  return (
    <div className="border border-surface-800 rounded overflow-hidden">
      {rows.map((row) => (
        <div key={row.label} className="flex text-[10px] font-mono border-b border-surface-800/50 last:border-b-0">
          <span className="px-2 py-1 text-surface-400 w-[40%] flex-shrink-0">{row.label}</span>
          <span className="px-2 py-1 text-surface-200">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function NetworkRequestDetail() {
  const selectedRequestId = useNetworkDebuggerStore((s) => s.selectedRequestId);
  const requests = useNetworkDebuggerStore((s) => s.requests);
  const [tab, setTab] = useState<DetailTab>("headers");

  const request = useMemo(
    () => (selectedRequestId ? requests.get(selectedRequestId) ?? null : null),
    [requests, selectedRequestId],
  );

  const curlCommand = useMemo(
    () => (request ? buildCurlCommand(request) : ""),
    [request],
  );

  if (!request) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-surface-500">
        Select a request to view details
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-2 gap-2">
      {/* Header with method + URL */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-700 text-surface-200">
          {request.method}
        </span>
        <span className="text-xs text-surface-300 truncate">{request.url}</span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <TabButton label="Headers" active={tab === "headers"} onClick={() => setTab("headers")} />
        <TabButton label="Body" active={tab === "body"} onClick={() => setTab("body")} />
        <TabButton label="Timing" active={tab === "timing"} onClick={() => setTab("timing")} />
        <div className="flex-1" />
        <CopyButton text={curlCommand} label="cURL" />
      </div>

      {/* Tab content */}
      {tab === "headers" && <HeadersTab />}
      {tab === "body" && <BodyTab />}
      {tab === "timing" && <TimingTab />}
    </div>
  );
}
