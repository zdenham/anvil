/**
 * Plan Tab Component
 *
 * Displays the plan associated with a task/thread.
 * Shows markdown content from the plan file with various states:
 * - Empty state (no plan associated)
 * - Loading state
 * - Error state
 * - Content state with markdown rendering
 */

import { useEffect, useState, useRef } from "react";
import { planService, usePlanStore } from "@/entities/plans";
import { MarkdownRenderer } from "@/components/thread/markdown-renderer";
import { AlertCircle, FileWarning } from "lucide-react";
import { logger } from "@/lib/logger-client";

interface PlanTabProps {
  planId: string | null;
}

export function PlanTab({ planId }: PlanTabProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planNotFound, setPlanNotFound] = useState(false);
  const [refreshAttempted, setRefreshAttempted] = useState(false);
  const markAsReadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const plan = usePlanStore((state) =>
    planId ? state.getPlan(planId) : undefined
  );

  // Stable values for effect dependencies - avoids re-running on isRead changes
  const planExists = !!plan;
  const planUpdatedAt = plan?.updatedAt;

  // Reset refresh state when planId changes
  useEffect(() => {
    setPlanNotFound(false);
    setRefreshAttempted(false);
    setContent(null);
    setError(null);
  }, [planId]);

  // Refresh plan from disk if not in store (handles cross-window sync and late hydration)
  useEffect(() => {
    if (!planId) return;
    if (plan) return; // Already in store
    if (refreshAttempted) return; // Already tried refresh

    const currentPlanId = planId; // Capture for closure (TypeScript needs this)
    logger.debug(`[PlanTab] Plan ${currentPlanId} not in store, attempting refresh from disk`);

    async function refreshPlan() {
      setLoading(true);
      setRefreshAttempted(true);
      try {
        await planService.refreshById(currentPlanId);
        // Check if plan is now in store
        const refreshedPlan = usePlanStore.getState().getPlan(currentPlanId);
        if (!refreshedPlan) {
          logger.debug(`[PlanTab] Plan ${currentPlanId} not found after refresh`);
          setPlanNotFound(true);
        }
      } catch (err) {
        logger.error(`[PlanTab] Failed to refresh plan ${currentPlanId}:`, err);
        setPlanNotFound(true);
      } finally {
        setLoading(false);
      }
    }

    refreshPlan();
  }, [planId, plan, refreshAttempted]);

  // Load plan content and mark as read (with delay, matching thread behavior)
  useEffect(() => {
    if (!planId || !planExists) {
      return;
    }

    // Clear any pending mark-as-read timeout
    if (markAsReadTimeoutRef.current) {
      clearTimeout(markAsReadTimeoutRef.current);
    }

    const currentPlanId = planId; // Capture for closure

    async function loadContent() {
      setLoading(true);
      setError(null);

      try {
        const planContent = await planService.getPlanContent(currentPlanId);
        setContent(planContent);

        // Mark as read after a slight delay (same pattern as threads)
        markAsReadTimeoutRef.current = setTimeout(() => {
          planService.markAsRead(currentPlanId);
        }, 500);
      } catch (err) {
        setError("Failed to load plan content");
        console.error("Failed to load plan:", err);
      } finally {
        setLoading(false);
      }
    }

    loadContent();

    // Cleanup timeout on unmount or planId change
    return () => {
      if (markAsReadTimeoutRef.current) {
        clearTimeout(markAsReadTimeoutRef.current);
      }
    };
  }, [planId, planExists, planUpdatedAt]);

  // No planId provided
  if (!planId) {
    return (
      <div
        className="flex items-center justify-center h-full text-muted-foreground text-sm"
        data-testid="plan-empty-state"
      >
        No plan yet
      </div>
    );
  }

  // Loading state (refreshing plan from disk or loading content)
  // Render blank screen - loading is fast enough that a spinner is jarring
  if (loading) {
    return <div className="h-full" data-testid="plan-loading-state" />;
  }

  // Plan not found after refresh attempt
  if (!plan && planNotFound) {
    return (
      <div
        className="flex items-center justify-center h-full text-muted-foreground text-sm"
        data-testid="plan-empty-state"
      >
        No plan yet
      </div>
    );
  }

  // Plan is being loaded from store (refresh in progress)
  // Render blank screen - loading is fast enough that a spinner is jarring
  if (!plan) {
    return <div className="h-full" data-testid="plan-loading-state" />;
  }

  // Error state
  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-destructive"
        data-testid="plan-error-state"
      >
        <AlertCircle className="w-12 h-12 mb-4" />
        <p>{error}</p>
        <p className="text-sm mt-2">The plan file may have been moved or deleted</p>
      </div>
    );
  }

  // Content not found
  if (content === null) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-muted-foreground"
        data-testid="plan-not-found-state"
      >
        <FileWarning className="w-12 h-12 mb-4" />
        <p>Plan file not found</p>
        <p className="text-sm mt-2">{plan.relativePath}</p>
      </div>
    );
  }

  // Render plan content
  return (
    <div className="h-full overflow-auto p-4" data-testid="plan-content">
      <p className="text-sm text-muted-foreground mb-4">
        {plan.relativePath}
      </p>
      <MarkdownRenderer content={content} />
    </div>
  );
}
