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
import { FileText, Loader2, AlertCircle, FileWarning } from "lucide-react";

interface PlanTabProps {
  planId: string | null;
}

export function PlanTab({ planId }: PlanTabProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markAsReadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const plan = usePlanStore((state) =>
    planId ? state.getPlan(planId) : undefined
  );

  // Load plan content and mark as read (with delay, matching thread behavior)
  useEffect(() => {
    if (!planId) {
      setContent(null);
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
  }, [planId]);

  // Empty state - no plan associated (always visible per design decision)
  if (!planId || !plan) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-muted-foreground"
        data-testid="plan-empty-state"
      >
        <FileText className="w-12 h-12 mb-4 opacity-50" />
        <p>No plan associated with this task</p>
        <p className="text-sm mt-2 text-center max-w-md">
          Plans are automatically detected when threads create or edit files in
          the plans/ directory, or when you mention a plan path in your message.
        </p>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        data-testid="plan-loading-state"
      >
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
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
        <p className="text-sm mt-2">{plan.path}</p>
      </div>
    );
  }

  // Render plan content
  return (
    <div className="h-full overflow-auto p-4" data-testid="plan-content">
      <div className="mb-4 pb-4 border-b">
        <h2 className="text-lg font-semibold">{plan.title}</h2>
        <p className="text-sm text-muted-foreground">{plan.path}</p>
      </div>
      <MarkdownRenderer content={content} />
    </div>
  );
}
