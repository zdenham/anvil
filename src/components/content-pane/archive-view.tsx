/**
 * ArchiveView
 *
 * Lists archived threads with the ability to unarchive them.
 * Accessible from the tree panel header dropdown.
 */

import { useState, useEffect, useCallback } from "react";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { threadService } from "@/entities/threads/service";
import { navigationService } from "@/stores/navigation-service";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { logger } from "@/lib/logger-client";
import type { ThreadMetadata } from "@/entities/threads/types";

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
    <div className="h-full overflow-y-auto">
      <div className="p-3 space-y-0.5">
        {threads.map((thread) => (
          <ArchivedThreadRow
            key={thread.id}
            thread={thread}
            isUnarchiving={unarchiving.has(thread.id)}
            onUnarchive={handleUnarchive}
          />
        ))}
      </div>
    </div>
  );
}

function ArchivedThreadRow({
  thread,
  isUnarchiving,
  onUnarchive,
}: {
  thread: ThreadMetadata;
  isUnarchiving: boolean;
  onUnarchive: (id: string) => void;
}) {
  const relativeTime = useRelativeTime(thread.updatedAt);

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
