import { useMemo } from "react";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { UnifiedInboxProps } from "./types";
import { InboxItemRow } from "./inbox-item";
import { createUnifiedList } from "./utils";
import { EmptyInboxState } from "./empty-inbox-state";
import { useNavigationMode } from "@/hooks/use-navigation-mode";
import { switchToThread, switchToPlan } from "@/lib/hotkey-service";

/**
 * Unified inbox component displaying threads and plans in a single interleaved list.
 *
 * Key design decisions:
 * - No filter tabs - single unified view
 * - No section headers - items are interleaved based on updatedAt
 * - Icon differentiation - MessageSquare for threads, FileText for plans
 * - Thread display shows last user message (truncated)
 * - Plan display shows plan filename (from relativePath)
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

  // Keyboard navigation support
  const { isNavigating, selectedIndex } = useNavigationMode({
    itemCount: items.length,
    onItemSelect: (index) => {
      const item = items[index];
      if (item.type === "thread") {
        switchToThread(item.data.id);
      } else if (item.type === "plan") {
        switchToPlan(item.data.id);
      }
    },
  });

  if (items.length === 0) {
    return <EmptyInboxState />;
  }

  return (
    <div className={className} data-testid="unified-inbox">
      <ul className="space-y-2 px-3 pt-3">
        {items.map((item, index) => (
          <InboxItemRow
            key={`${item.type}-${item.data.id}`}
            item={item}
            isSelected={isNavigating && selectedIndex === index}
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
