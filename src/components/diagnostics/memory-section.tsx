import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getMemorySummary, captureMemorySnapshot } from "@/lib/memory-snapshot";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 5_000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function heapColor(bytes: number): string {
  if (bytes < 500 * 1024 * 1024) return "text-green-400";
  if (bytes < 1024 * 1024 * 1024) return "text-amber-400";
  return "text-red-400";
}

function heapDot(bytes: number): string {
  if (bytes < 500 * 1024 * 1024) return "bg-green-500";
  if (bytes < 1024 * 1024 * 1024) return "bg-amber-400";
  return "bg-red-500";
}

export function MemorySection() {
  const [summary, setSummary] = useState(() => getMemorySummary());
  const [isCapturing, setIsCapturing] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setSummary(getMemorySummary());
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const handleCaptureSnapshot = useCallback(async () => {
    setIsCapturing(true);
    try {
      const snapshot = await captureMemorySnapshot();
      const path = await invoke<string>("write_memory_snapshot", {
        snapshotJson: JSON.stringify(snapshot, null, 2),
      });
      logger.info(`[MemorySection] Snapshot written to ${path}`);
    } catch (err) {
      logger.error("[MemorySection] Failed to capture snapshot:", err);
    } finally {
      setIsCapturing(false);
    }
  }, []);

  const heapUsed = summary.jsHeap?.usedJSHeapSize ?? 0;
  const heapTotal = summary.jsHeap?.totalJSHeapSize ?? 0;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">
          Memory
        </h4>
        <button
          onClick={handleCaptureSnapshot}
          disabled={isCapturing}
          className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
        >
          {isCapturing ? "Capturing..." : "Capture Snapshot"}
        </button>
      </div>

      <div className="space-y-1">
        {/* JS Heap */}
        {summary.jsHeap && (
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", heapDot(heapUsed))} />
            <span className={cn("flex-shrink-0", heapColor(heapUsed))}>
              JS Heap
            </span>
            <span className="text-surface-400">
              {formatBytes(heapUsed)} / {formatBytes(heapTotal)}
            </span>
          </div>
        )}

        {/* Cached thread states */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className={cn(
            "inline-block w-2 h-2 rounded-full flex-shrink-0",
            summary.cachedStateEstimateBytes > 500 * 1024 * 1024 ? "bg-red-500"
              : summary.cachedStateEstimateBytes > 100 * 1024 * 1024 ? "bg-amber-400"
              : "bg-green-500"
          )} />
          <span className="text-surface-400 flex-shrink-0">Thread states</span>
          <span className="text-surface-400">
            {summary.cachedStateCount} cached ~{formatBytes(summary.cachedStateEstimateBytes)}
          </span>
        </div>

        {/* Terminal buffers */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-surface-500" />
          <span className="text-surface-400 flex-shrink-0">Terminal buffers</span>
          <span className="text-surface-400">
            {summary.terminalBufferCount} buffers {formatBytes(summary.terminalBufferBytes)}
          </span>
        </div>

        {/* Active streams */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-surface-500" />
          <span className="text-surface-400 flex-shrink-0">Active streams</span>
          <span className="text-surface-400">{summary.activeStreamCount}</span>
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-surface-500" />
          <span className="text-surface-400 flex-shrink-0">Thread metadata</span>
          <span className="text-surface-400">{summary.threadMetadataCount} entries</span>
        </div>
      </div>
    </section>
  );
}
