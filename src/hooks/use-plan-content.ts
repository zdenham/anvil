import { useState, useEffect } from "react";
import { planService } from "@/entities/plans/service";

/**
 * Hook to load and cache plan file content.
 * Returns null while loading, string when loaded.
 *
 * @param planId - The ID of the plan to load content for
 * @returns The plan content as a string, or null if loading/not found
 */
export function usePlanContent(planId: string | null): string | null {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (!planId) {
      setContent(null);
      return;
    }

    // Reset content on planId change
    setContent(null);

    // Load content
    planService.getPlanContent(planId).then(setContent);
  }, [planId]);

  return content;
}
