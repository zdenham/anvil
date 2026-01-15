import { useCallback } from "react";
import { useSimpleTaskNavigation } from "./use-simple-task-navigation";
import { useNavigationBannerStore } from "@/stores/navigation-banner-store";

// Helper to get action-specific completion messages
function getCompletionMessage(actionType: 'archive' | 'markUnread' | 'quickAction'): string {
  switch (actionType) {
    case 'archive':
      return 'Task archived';
    case 'markUnread':
      return 'Marked unread';
    case 'quickAction':
      return 'Task skipped';
    default:
      return 'Task completed';
  }
}

export function useNavigateToNextTask(currentTaskId: string) {
  const { getNextUnreadTaskId } = useSimpleTaskNavigation(currentTaskId);
  const { showBanner } = useNavigationBannerStore();

  /**
   * Navigate to next unread task with consistent fallback behavior.
   * If no unread tasks available, navigates to tasks panel.
   *
   * @param options.fallbackToTasksPanel - Whether to show tasks panel if no next task (default: true)
   * @param options.actionType - Type of action that triggered navigation for banner message
   * @returns Promise<boolean> - true if navigated to next task, false if fell back to tasks panel
   */
  const navigateToNextTaskOrFallback = useCallback(async (
    options: {
      fallbackToTasksPanel?: boolean;
      actionType?: 'archive' | 'markUnread' | 'quickAction';
    } = {}
  ): Promise<boolean> => {
    const { fallbackToTasksPanel = true, actionType = 'quickAction' } = options;

    console.log(`[DEBUG] navigateToNextTaskOrFallback called`, {
      currentTaskId,
      actionType,
      fallbackToTasksPanel
    });

    // Get next unread task
    const result = await getNextUnreadTaskId(currentTaskId);

    if (result.taskId && result.threadId) {
      // Import openSimpleTask dynamically to avoid circular imports
      const { openSimpleTask } = await import("@/lib/hotkey-service");
      await openSimpleTask(result.threadId, result.taskId);

      // Show success banner with completion confirmation
      const completionMessage = getCompletionMessage(actionType);
      showBanner(completionMessage, "Next task focused");

      return true; // Navigation successful
    }

    // No unread tasks available - fallback to tasks panel if requested
    if (fallbackToTasksPanel) {
      const { showTasksPanel } = await import("@/lib/hotkey-service");
      await showTasksPanel();

      // Show fallback banner
      const completionMessage = getCompletionMessage(actionType);
      showBanner(completionMessage, "Switched to tasks panel");
    }

    return false; // No next task available or fallback occurred
  }, [currentTaskId, getNextUnreadTaskId, showBanner]);

  return {
    navigateToNextTaskOrFallback,
  };
}