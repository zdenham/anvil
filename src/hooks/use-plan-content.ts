import { useState, useEffect } from "react";
import { planService } from "@/entities/plans/service";
import { usePlanStore } from "@/entities/plans/store";

interface PlanContentResult {
  content: string | null;
  isLoading: boolean;
  /** Whether the plan file was not found on last access */
  isStale: boolean;
}

/**
 * Hook to load and cache plan file content.
 * Returns content, loading state, and stale status.
 *
 * @param planId - The ID of the plan to load content for
 * @returns Object with content (string or null), isLoading state, and isStale flag
 */
export function usePlanContent(planId: string | null): PlanContentResult {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Subscribe to plan's stale status from the store
  const isStale = usePlanStore((s) => {
    if (!planId) return false;
    const plan = s.getPlan(planId);
    return plan?.stale ?? false;
  });

  useEffect(() => {
    if (!planId) {
      setContent(null);
      setIsLoading(false);
      return;
    }

    // Don't reset content to null - keep showing previous content until new is ready
    // This prevents flash of blank content during transitions
    setIsLoading(true);

    // Load content (this also updates stale status in the store)
    planService.getPlanContent(planId).then((result) => {
      setContent(result);
      setIsLoading(false);
    });
  }, [planId]);

  return { content, isLoading, isStale };
}
