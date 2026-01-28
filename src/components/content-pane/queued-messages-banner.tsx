/**
 * QueuedMessagesBanner
 *
 * Displays count of queued messages while agent is running.
 * Reads from useQueuedMessagesStore (read-only).
 * Calls queuedMessagesService.clear() if user cancels queue.
 *
 * This is a re-export/wrapper of the control-panel version for use in the new content-pane system.
 * In a future phase, this could become the canonical implementation.
 */

// Re-export from control-panel for now
// The existing implementation already follows the patterns we need
export { QueuedMessagesBanner } from "@/components/control-panel/queued-messages-banner";
