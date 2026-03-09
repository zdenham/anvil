/**
 * ArchiveView
 *
 * Lists archived threads with the ability to unarchive them.
 * Accessible from the tree panel header dropdown.
 * Uses paginated loading — fetches 50 threads at a time via Rust-side grep.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useVirtualList } from "@/hooks/use-virtual-list";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { threadService } from "@/entities/threads/service";
import { navigationService } from "@/stores/navigation-service";
import { formatRelativeTime } from "@/lib/utils/time-format";
import { logger } from "@/lib/logger-client";
import type { ThreadMetadata } from "@/entities/threads/types";

const ROW_HEIGHT = 44;
const OVERSCAN = 660; // ~15 rows
const PAGE_SIZE = 50;

export function ArchiveView() {
  const [threads, setThreads] = useState<ThreadMetadata[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unarchiving, setUnarchiving] = useState<Set<string>>(new Set());

  const loadArchived = useCallback(async () => {
    try {
      const result = await threadService.listArchived({ limit: PAGE_SIZE, offset: 0 });
      setThreads(result.threads);
      setTotal(result.total);
    } catch (err) {
      logger.error("[ArchiveView] Failed to load archived threads:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await threadService.listArchived({
        limit: PAGE_SIZE,
        offset: threads.length,
      });
      setThreads((prev) => [...prev, ...result.threads]);
      setTotal(result.total);
    } catch (err) {
      logger.error("[ArchiveView] Failed to load more archived threads:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [threads.length, loadingMore]);

  useEffect(() => {
    loadArchived();
  }, [loadArchived]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now);

  const getScrollElement = useCallback(() => scrollRef.current, []);

  const { items, totalHeight } = useVirtualList({
    count: threads.length,
    getScrollElement,
    itemHeight: ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Single timer for relative timestamps instead of per-row timers
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Load more when scrolled near the bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingMore || threads.length >= total) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 500) {
      loadMore();
    }
  }, [loadMore, loadingMore, threads.length, total]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const handleUnarchive = useCallback(async (threadId: string) => {
    setUnarchiving((prev) => new Set(prev).add(threadId));
    // Optimistically remove from list
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    setTotal((prev) => prev - 1);

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

  return (
    <div data-testid="archive-view" className="flex flex-col h-full">
      {!loading && threads.length > 0 && (
        <div className="px-4 py-2 text-xs text-surface-500 border-b border-surface-800">
          {total.toLocaleString()} archived threads
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-surface-500">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : threads.length === 0 ? (
          <div className="flex items-center justify-center h-full text-surface-500">
            <p className="text-sm">No archived threads</p>
          </div>
        ) : (
          <>
            <div className="relative p-3" style={{ height: totalHeight }}>
              {items.map((item) => {
                const thread = threads[item.index];
                return (
                  <div
                    key={thread.id}
                    className="absolute left-0 right-0 px-3"
                    style={{
                      height: item.size,
                      transform: `translateY(${item.start}px)`,
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
            {loadingMore && (
              <div className="flex justify-center py-3">
                <Loader2 size={16} className="animate-spin text-surface-500" />
              </div>
            )}
          </>
        )}
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
