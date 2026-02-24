/**
 * ArchiveView
 *
 * Lists archived threads with the ability to unarchive them.
 * Accessible from the tree panel header dropdown.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { threadService } from "@/entities/threads/service";
import { navigationService } from "@/stores/navigation-service";
import { formatRelativeTime } from "@/lib/utils/time-format";
import { logger } from "@/lib/logger-client";
import type { ThreadMetadata } from "@/entities/threads/types";

const ROW_HEIGHT = 44;
const OVERSCAN = 15;

export function ArchiveView() {
  const [threads, setThreads] = useState<ThreadMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [unarchiving, setUnarchiving] = useState<Set<string>>(new Set());

  const loadArchived = useCallback(async () => {
    try {
      const archived = await threadService.listArchived();
      archived.sort((a, b) => b.updatedAt - a.updatedAt);
      setThreads(archived);
    } catch (err) {
      logger.error("[ArchiveView] Failed to load archived threads:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadArchived();
  }, [loadArchived]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now);

  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Single timer for relative timestamps instead of per-row timers
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleUnarchive = useCallback(async (threadId: string) => {
    setUnarchiving((prev) => new Set(prev).add(threadId));
    // Optimistically remove from list
    setThreads((prev) => prev.filter((t) => t.id !== threadId));

    try {
      await threadService.unarchive(threadId);
      // Navigate to the restored thread
      await navigationService.navigateToThread(threadId);
    } catch (err) {
      logger.error(`[ArchiveView] Failed to unarchive thread ${threadId}:`, err);
      // Reload list to restore the item
      await loadArchived();
    } finally {
      setUnarchiving((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
    }
  }, [loadArchived]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-surface-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-surface-500">
        <p className="text-sm">No archived threads</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div
        className="relative p-3"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const thread = threads[virtualRow.index];
          return (
            <div
              key={thread.id}
              className="absolute left-0 right-0 px-3"
              style={{
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ArchivedThreadRow
                thread={thread}
                now={now}
                isUnarchiving={unarchiving.has(thread.id)}
                onUnarchive={handleUnarchive}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArchivedThreadRow({
  thread,
  now,
  isUnarchiving,
  onUnarchive,
}: {
  thread: ThreadMetadata;
  now: number;
  isUnarchiving: boolean;
  onUnarchive: (id: string) => void;
}) {
  const relativeTime = formatRelativeTime(thread.updatedAt, now);

  const label = thread.name
    ?? thread.turns[0]?.prompt?.slice(0, 80)
    ?? thread.id.slice(0, 8);

  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-800 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-surface-200 truncate">{label}</p>
        <p className="text-xs text-surface-500">{relativeTime}</p>
      </div>
      <button
        onClick={() => onUnarchive(thread.id)}
        disabled={isUnarchiving}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 disabled:opacity-50 transition-all"
        aria-label="Unarchive thread"
        title="Unarchive"
      >
        {isUnarchiving ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <ArchiveRestore size={14} />
        )}
      </button>
    </div>
  );
}
