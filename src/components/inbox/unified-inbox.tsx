import { useMemo } from "react";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { UnifiedInboxProps } from "./types";
import { InboxItemRow } from "./inbox-item";
import { createUnifiedList } from "./utils";
import { EmptyInboxState } from "./empty-inbox-state";

/**
 * Unified inbox component displaying threads and plans in a single interleaved list.
 *
 * Key design decisions:
 * - No filter tabs - single unified view
 * - No section headers - items are interleaved based on updatedAt
 * - Icon differentiation - MessageSquare for threads, FileText for plans
 * - Thread display shows last user message (truncated)
 * - Plan display shows plan filename (from relativePath)
 *
 * Note: This component does NOT handle global hotkey navigation. Global hotkey
 * navigation (Alt+Up/Down) only affects the inbox-list panel, not this main
 * window inbox view. Direct clicks on items are the only way to select here.
 */
export function UnifiedInbox({
  threads,
  plans,
  threadLastMessages,
  onThreadSelect,
  onPlanSelect,
  className = "",
}: UnifiedInboxProps) {
  // Create unified list sorted by updatedAt
  const items = useMemo(
    () => createUnifiedList(threads, plans, threadLastMessages),
    [threads, plans, threadLastMessages]
  );

  if (items.length === 0) {
    return <EmptyInboxState />;
  }

  return (
    <div className={className} data-testid="unified-inbox">
      <ul className="space-y-2 px-3 pt-3">
        {items.map((item) => (
          <InboxItemRow
            key={`${item.type}-${item.data.id}`}
            item={item}
            isSelected={false}
            onSelect={() => {
              if (item.type === "thread") {
                onThreadSelect(item.data as ThreadMetadata);
              } else {
                onPlanSelect(item.data as PlanMetadata);
              }
            }}
          />
        ))}
      </ul>
    </div>
  );
}
