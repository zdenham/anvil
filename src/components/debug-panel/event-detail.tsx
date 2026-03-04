import { useState, useCallback, useMemo } from "react";
import { Copy, Check, ChevronDown, ChevronRight, HardDrive, Loader2 } from "lucide-react";
import { useEventDebuggerStore, type CapturedEvent } from "@/stores/event-debugger-store";
import { readThreadFromDisk } from "@/lib/thread-disk-reader";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";

// ============================================================================
// Constants
// ============================================================================

const TYPE_BADGE_STYLES: Record<string, string> = {
  state: "bg-blue-500/20 text-blue-400",
  event: "bg-green-500/20 text-green-400",
  drain: "bg-orange-500/20 text-orange-400",
  heartbeat: "bg-surface-500/20 text-surface-400",
  log: "bg-yellow-500/20 text-yellow-400",
};

// ============================================================================
// Sub-components
// ============================================================================

function PipelineStamps({ pipeline }: { pipeline: CapturedEvent["pipeline"] }) {
  if (!pipeline || pipeline.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono text-surface-400">
      {pipeline.map((stamp, i) => (
        <span key={`${stamp.stage}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-surface-600">{">"}</span>}
          <span className="text-surface-300">{stamp.stage}</span>
          <span className="text-surface-500">({stamp.ts})</span>
        </span>
      ))}
    </div>
  );
}

function CollapsibleJson({ label, data }: { label: string; data: unknown }) {
  const [expanded, setExpanded] = useState(true);

  const jsonStr = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return "Failed to serialize";
    }
  }, [data]);

  return (
    <div className="border border-surface-800 rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 w-full px-2 py-1 text-xs text-surface-300 hover:bg-surface-800 transition-colors"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {label}
      </button>
      {expanded && (
        <pre className="px-2 py-1 text-[10px] font-mono text-surface-300 overflow-auto max-h-60 border-t border-surface-800">
          {jsonStr}
        </pre>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      logger.warn("[event-detail] Failed to copy to clipboard", err);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : "Copy JSON"}
    </button>
  );
}

// ============================================================================
// Disk State Reader
// ============================================================================

function DiskStateReader({ threadId }: { threadId: string }) {
  const [inputThreadId, setInputThreadId] = useState(threadId);
  const diskState = useEventDebuggerStore((s) => s.diskState);
  const diskStateLoading = useEventDebuggerStore((s) => s.diskStateLoading);
  const diskStateThreadId = useEventDebuggerStore((s) => s.diskStateThreadId);
  const setDiskState = useEventDebuggerStore((s) => s.setDiskState);
  const setDiskStateLoading = useEventDebuggerStore((s) => s.setDiskStateLoading);

  const handleRead = useCallback(async () => {
    if (!inputThreadId.trim()) return;
    setDiskStateLoading(true);
    try {
      const snapshot = await readThreadFromDisk(inputThreadId.trim());
      const combined: Record<string, unknown> = {};
      if (snapshot.metadata) combined.metadata = snapshot.metadata;
      if (snapshot.state) combined.state = snapshot.state;
      setDiskState(inputThreadId.trim(), combined);
    } catch (err) {
      logger.warn("[event-detail] Failed to read disk state", err);
      setDiskStateLoading(false);
    }
  }, [inputThreadId, setDiskState, setDiskStateLoading]);

  return (
    <div className="border-t border-surface-700 pt-2 mt-2">
      <h4 className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider mb-1">
        Disk State Reader
      </h4>
      <div className="flex items-center gap-1 mb-1">
        <input
          type="text"
          value={inputThreadId}
          onChange={(e) => setInputThreadId(e.target.value)}
          placeholder="Thread ID"
          className="flex-1 bg-surface-800 rounded px-2 py-0.5 text-xs font-mono text-surface-200 placeholder:text-surface-600 outline-none border border-surface-700 focus:border-accent-500"
        />
        <button
          onClick={handleRead}
          disabled={diskStateLoading}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-surface-800 text-surface-300 hover:bg-surface-700 transition-colors disabled:opacity-50"
        >
          {diskStateLoading ? <Loader2 size={10} className="animate-spin" /> : <HardDrive size={10} />}
          Read
        </button>
      </div>
      {diskState && diskStateThreadId === inputThreadId.trim() && (
        <div className="space-y-1">
          <div className="flex justify-end">
            <CopyButton text={JSON.stringify(diskState, null, 2)} />
          </div>
          {(diskState as Record<string, unknown>).metadata != null ? (
            <CollapsibleJson label="metadata.json" data={(diskState as Record<string, unknown>).metadata} />
          ) : null}
          {(diskState as Record<string, unknown>).state != null ? (
            <CollapsibleJson label="state.json" data={(diskState as Record<string, unknown>).state} />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function EventDetail() {
  const selectedEventId = useEventDebuggerStore((s) => s.selectedEventId);
  const events = useEventDebuggerStore((s) => s.events);

  const event = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  if (!event) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-surface-500">
        Select an event to view details
      </div>
    );
  }

  const badgeStyle = TYPE_BADGE_STYLES[event.type] ?? "bg-surface-500/20 text-surface-400";
  const payloadJson = JSON.stringify(event.payload, null, 2);

  return (
    <div data-testid="event-detail" className="flex flex-col h-full overflow-auto p-2 gap-2">
      {/* Header */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", badgeStyle)}>
          {event.type}
        </span>
        {event.name && <span className="text-xs text-surface-200 font-medium">{event.name}</span>}
        {event.source && <span className="text-[10px] text-surface-500">{event.source}</span>}
        <span className="ml-auto text-[10px] text-surface-500">{event.size} bytes</span>
      </div>

      {/* Pipeline stamps */}
      <PipelineStamps pipeline={event.pipeline} />

      {/* Payload */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <h4 className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">
          Payload
        </h4>
        <CopyButton text={payloadJson} />
      </div>
      <CollapsibleJson label="Full Payload" data={event.payload} />

      {/* Disk state reader */}
      {event.threadId && <DiskStateReader threadId={event.threadId} />}
    </div>
  );
}
