import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";

/**
 * Union type for unified list items.
 * Items are interleaved in the inbox based on updatedAt.
 */
export type InboxItem =
  | { type: "thread"; data: ThreadMetadata; sortKey: number; displayText: string }
  | { type: "plan"; data: PlanMetadata; sortKey: number; displayText: string };

/**
 * Props for the UnifiedInbox component.
 */
export interface UnifiedInboxProps {
  /** Array of threads to display */
  threads: ThreadMetadata[];
  /** Array of plans to display */
  plans: PlanMetadata[];
  /** Last user message for each thread (for display) */
  threadLastMessages: Record<string, string>;
  /** Callback when a thread is selected */
  onThreadSelect: (thread: ThreadMetadata) => void;
  /** Callback when a plan is selected */
  onPlanSelect: (plan: PlanMetadata) => void;
  /** Custom CSS classes for the container */
  className?: string;
}
