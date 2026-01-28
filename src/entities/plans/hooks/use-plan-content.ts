/**
 * usePlanContent Hook
 *
 * Hook to load plan markdown content from disk.
 * Returns the content string, loading state, and stale status.
 *
 * This is a copy of the existing hook at src/hooks/use-plan-content.ts
 * placed here for consistency with the entity pattern. The original
 * hook is still available for backwards compatibility.
 *
 * Note: The hook calls planService.getPlanContent() which handles disk I/O.
 * The component never reads disk directly.
 */

import { useState, useEffect } from "react";
import { planService } from "@/entities/plans/service";
import { usePlanStore } from "@/entities/plans/store";

interface PlanContentResult {
  content: string | null;
  isLoading: boolean;
  /** Whether the plan file was not found on last access */
  isStale: boolean;
  error: Error | null;
}

/**
 * Hook to load and cache plan file content.
 * Returns content, loading state, stale status, and error.
 *
 * @param planId - The ID of the plan to load content for
 * @returns Object with content (string or null), isLoading state, isStale flag, and error
 */
export function usePlanContent(planId: string | null): PlanContentResult {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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
      setError(null);
      return;
    }

    let cancelled = false;

    // Don't reset content to null - keep showing previous content until new is ready
    // This prevents flash of blank content during transitions
    setIsLoading(true);
    setError(null);

    // Load content (this also updates stale status in the store)
    planService
      .getPlanContent(planId)
      .then((result) => {
        if (!cancelled) {
          setContent(result);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [planId]);

  return { content, isLoading, isStale, error };
}
