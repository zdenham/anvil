import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { InboxItem } from "@/types/navigation";
import { getPlanDisplayName } from "@/entities/plans/utils";

/**
 * Combine threads and plans into a single sorted list.
 * Items are sorted by updatedAt descending (most recent first).
 */
export function createUnifiedList(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  threadLastMessages: Record<string, string>
): InboxItem[] {
  const items: InboxItem[] = [
    ...threads.map((t) => ({
      type: "thread" as const,
      data: t,
      sortKey: t.updatedAt,
      displayText: threadLastMessages[t.id] || t.id.slice(0, 8),
    })),
    ...plans.map((p) => ({
      type: "plan" as const,
      data: p,
      sortKey: p.updatedAt,
      displayText: getPlanDisplayName(p),
    })),
  ];

  // Sort by updatedAt descending (most recent first)
  return items.sort((a, b) => b.sortKey - a.sortKey);
}
