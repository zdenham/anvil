/**
 * Plan View Component
 *
 * Displays plan content in the control panel.
 * Single view showing:
 * - Plan header with name and close button
 * - Rendered markdown content (read-only)
 * - Plan metadata (created date, related threads count)
 * - Quick actions panel (create thread, edit, delete)
 */

import { useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlanStore } from "@/entities/plans/store";
import { usePlanContent } from "@/hooks/use-plan-content";
import { MarkdownRenderer } from "@/components/thread/markdown-renderer";
import { ControlPanelHeader } from "./control-panel-header";
import { SuggestedActionsPanel, type SuggestedActionsPanelRef } from "./suggested-actions-panel";
import { useRelatedThreads } from "@/entities/relations";
import { useQuickActionsStore, planDefaultActions, type ActionType } from "@/stores/quick-actions-store";
import { logger } from "@/lib/logger-client";

interface PlanViewProps {
  planId: string;
}

export function PlanView({ planId }: PlanViewProps) {
  const plan = usePlanStore((s) => s.getPlan(planId));
  const content = usePlanContent(planId);
  const relatedThreads = useRelatedThreads(planId);
  const quickActionsPanelRef = useRef<SuggestedActionsPanelRef>(null);

  // Quick actions store for keyboard navigation
  const {
    selectedIndex,
    isProcessing,
    setProcessing,
    resetState,
    navigateUp,
    navigateDown,
  } = useQuickActionsStore();

  // Reset quick actions state when planId changes
  useEffect(() => {
    resetState();
  }, [planId, resetState]);

  // Focus restoration on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      quickActionsPanelRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [planId]);

  const handleQuickAction = useCallback(async (action: ActionType) => {
    if (isProcessing) return;

    setProcessing(action);
    try {
      if (action === "createThread") {
        // TODO: Implement create thread from plan
        logger.warn("[PlanView] Create thread not yet implemented");
      } else if (action === "editPlan") {
        // TODO: Implement edit plan
        logger.warn("[PlanView] Edit plan not yet implemented");
      } else if (action === "deletePlan") {
        // TODO: Implement delete plan
        logger.warn("[PlanView] Delete plan not yet implemented");
      } else if (action === "closePanel") {
        await invoke("hide_control_panel");
      }
    } catch (error) {
      logger.error(`[PlanView] Failed to handle quick action ${action}:`, error);
    } finally {
      setProcessing(null);
    }
  }, [isProcessing, setProcessing]);

  // Placeholder for legacy action handler (not used for plans)
  const handleLegacyAction = useCallback(async (_action: "markUnread" | "archive") => {
    // No-op for plan view
  }, []);

  // Global keyboard navigation for quick actions
  useEffect(() => {
    const actions = planDefaultActions;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle arrow keys
      if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateUp(actions.length);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateDown(actions.length);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selectedAction = actions[selectedIndex];
        if (selectedAction) {
          handleQuickAction(selectedAction.key);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        invoke("hide_control_panel");
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, navigateUp, navigateDown, handleQuickAction]);

  // Minimal error handling: just show "Plan not found"
  if (!plan) {
    return (
      <div className="flex flex-col h-screen text-surface-50 relative overflow-hidden">
        <ControlPanelHeader view={{ type: "plan", planId }} />
        <div className="flex items-center justify-center flex-1 text-surface-400">
          Plan not found
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen text-surface-50 relative overflow-hidden">
      <ControlPanelHeader view={{ type: "plan", planId }} />

      {/* Main content area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {content ? (
          <MarkdownRenderer content={content} />
        ) : (
          <div className="text-surface-400">Loading plan content...</div>
        )}
      </div>

      {/* Quick actions panel */}
      <SuggestedActionsPanel
        ref={quickActionsPanelRef}
        view={{ type: "plan", planId }}
        onAction={handleLegacyAction}
        isStreaming={false}
        onQuickAction={handleQuickAction}
      />

      {/* Plan metadata footer */}
      <div className="px-4 py-3 bg-surface-800 border-t border-surface-700 text-xs text-surface-400">
        <div className="flex items-center gap-4">
          {plan.createdAt && (
            <span>Created: {new Date(plan.createdAt).toLocaleDateString()}</span>
          )}
          <span>{relatedThreads.length} related thread{relatedThreads.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}
