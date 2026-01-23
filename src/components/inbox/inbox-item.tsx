import { useMemo } from "react";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { InboxItem } from "./types";
import { getThreadStatusVariant, getPlanStatusVariant } from "@/utils/thread-colors";
import { useRelationStore } from "@/entities/relations/store";
import { useThreadStore } from "@/entities/threads/store";
import { ArchiveButton } from "./archive-button";
import { threadService } from "@/entities/threads/service";
import { planService } from "@/entities/plans/service";
import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";

interface InboxItemRowProps {
  item: InboxItem;
  onSelect: () => void;
  /** Whether this item is selected during keyboard navigation */
  isSelected?: boolean;
}

/**
 * A single row in the inbox list.
 * Displays either a thread or plan with status dot and archive button.
 */
export function InboxItemRow({ item, onSelect, isSelected }: InboxItemRowProps) {
  const variant = useItemDotVariant(item);

  const handleArchive = async () => {
    if (item.type === "thread") {
      await threadService.archive(item.data.id);
    } else {
      await planService.archive(item.data.id);
    }
  };

  // Highlight border when selected during keyboard navigation
  const borderClass = isSelected
    ? "border-accent-500"
    : "border-surface-700 hover:border-surface-600";

  return (
    <li
      onClick={onSelect}
      className={`group flex items-center gap-3 px-3 py-2 bg-surface-800 rounded-lg border ${borderClass} cursor-pointer transition-colors`}
      data-testid="inbox-item"
      data-item-type={item.type}
      data-selected={isSelected}
    >
      {/* Status dot */}
      <StatusDot
        variant={variant}
        data-testid="status-dot"
      />


      {/* Display text - last message for threads, filename for plans */}
      <span
        className="flex-1 text-sm text-surface-100 truncate font-mono"
        data-testid="inbox-item-text"
      >
        {item.displayText}
      </span>

      {/* Archive button with two-click confirmation */}
      <ArchiveButton onArchive={handleArchive} />
    </li>
  );
}

/**
 * Hook to determine the dot variant for an inbox item.
 * For threads, uses thread status directly.
 * For plans, derives running status from associated threads.
 */
function useItemDotVariant(item: InboxItem): StatusDotVariant {
  // Get planId outside the conditional (hooks must be called unconditionally)
  const planId = item.type === "plan" ? (item.data as PlanMetadata).id : null;

  // Always call hooks (React rules), but only use results for plans
  // Use the cached array to avoid creating new arrays on each render
  const relationsArray = useRelationStore((s) => s._relationsArray);
  const threads = useThreadStore((s) => s.threads);

  // For threads, use thread status directly
  if (item.type === "thread") {
    return getThreadStatusVariant(item.data as ThreadMetadata);
  }

  // For plans, derive running status from associated threads
  const plan = item.data as PlanMetadata;

  // Memoize the hasRunningThread calculation to prevent unnecessary recalculations
  const hasRunningThread = useMemo(() => {
    if (!planId) return false;

    const relations = relationsArray.filter(
      (r) => r.planId === planId && !r.archived
    );

    return relations.some((rel) => {
      const thread = threads[rel.threadId];
      return thread?.status === "running";
    });
  }, [planId, relationsArray, threads]);

  return getPlanStatusVariant(plan.isRead, hasRunningThread, plan.stale);
}
