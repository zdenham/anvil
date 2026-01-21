import { useEffect, useRef } from "react";
import { planService } from "./service";

/**
 * Hook to automatically mark a plan as read when viewed.
 * Uses a delay to match thread behavior and prevent accidental mark-as-read.
 */
export function useMarkPlanAsRead(planId: string | null, delay = 500) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!planId) return;

    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Mark as read after delay
    timeoutRef.current = setTimeout(() => {
      planService.markAsRead(planId);
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [planId, delay]);
}
