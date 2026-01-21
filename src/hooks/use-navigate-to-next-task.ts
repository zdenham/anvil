import { useCallback } from "react";
import { useSimpleTaskNavigation } from "./use-simple-task-navigation";
import { useNavigationBannerStore } from "@/stores/navigation-banner-store";
import { isPanelVisible, switchSimpleTaskClientSide, openSimpleTask } from "@/lib/hotkey-service";
import type { SimpleTaskView } from "@/components/simple-task/simple-task-header";

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
   * Navigate to next unread item (task with unread thread OR unread plan).
   * If no unread items available, navigates to tasks panel.
   *
   * Navigation prioritizes unread threads over unread plans:
   * - If task has unread thread, opens thread view
   * - If task has read thread but unread plan, opens plan view
   *
   * @param options.fallbackToTasksPanel - Whether to show tasks panel if no next item (default: true)
   * @param options.actionType - Type of action that triggered navigation for banner message
   * @returns Promise<boolean> - true if navigated to next item, false if fell back to tasks panel
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

    // Get next unread item (task with unread thread or plan)
    const result = await getNextUnreadTaskId(currentTaskId);

    if (result.taskId && result.threadId) {
      // Determine initial view based on whether to open plan tab
      const initialView: SimpleTaskView = result.openPlanTab ? "plan" : "thread";

      console.log(`[DEBUG] navigateToNextTaskOrFallback: Navigating to task`, {
        taskId: result.taskId,
        threadId: result.threadId,
        openPlanTab: result.openPlanTab,
        initialView
      });

      // Check if simple-task panel is already visible
      // If so, use client-side navigation to avoid IPC round-trips and focus flickering
      const isSimpleTaskVisible = await isPanelVisible("simple-task");

      if (isSimpleTaskVisible) {
        // Client-side switch - no IPC needed, avoids blur events during navigation
        switchSimpleTaskClientSide(result.threadId, result.taskId, undefined, initialView);
      } else {
        // Panel not visible - need to show it via Tauri
        await openSimpleTask(result.threadId, result.taskId);
        // Note: For IPC navigation, the initialView is handled via eventBus after panel mounts
        // We emit a separate event to set the initial view when needed
        if (result.openPlanTab) {
          // Emit event to set initial view after panel mounts
          const { eventBus } = await import("@/entities");
          eventBus.emit("open-simple-task", {
            threadId: result.threadId,
            taskId: result.taskId,
            initialView
          });
        }
      }

      // Show success banner with completion confirmation
      const completionMessage = getCompletionMessage(actionType);
      showBanner(completionMessage, "Next unread focused");

      return true; // Navigation successful
    }

    // No unread items available - fallback to tasks panel if requested
    if (fallbackToTasksPanel) {
      const { showTasksPanel } = await import("@/lib/hotkey-service");
      await showTasksPanel();

      // Show fallback banner
      const completionMessage = getCompletionMessage(actionType);
      showBanner(completionMessage, "All caught up");
    }

    return false; // No next item available or fallback occurred
  }, [currentTaskId, getNextUnreadTaskId, showBanner]);

  return {
    navigateToNextTaskOrFallback,
  };
}