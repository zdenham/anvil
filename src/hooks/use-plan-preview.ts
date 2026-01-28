import { usePlanContent } from "./use-plan-content";
import { getPlanPreviewContent } from "@/lib/preview-content";

interface PlanPreviewResult {
  preview: string | null;
  isLoading: boolean;
}

/**
 * Hook to get a plaintext preview of a plan's content.
 * Returns the first X characters of the plan file.
 */
export function usePlanPreview(planId: string | null): PlanPreviewResult {
  const { content, isLoading } = usePlanContent(planId);
  return {
    preview: getPlanPreviewContent(content),
    isLoading,
  };
}
