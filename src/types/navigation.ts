import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";

/**
 * Union type for unified list items.
 * Items are interleaved in the inbox based on updatedAt.
 */
export type InboxItem =
  | { type: "thread"; data: ThreadMetadata; sortKey: number; displayText: string }
  | { type: "plan"; data: PlanMetadata; sortKey: number; displayText: string };
