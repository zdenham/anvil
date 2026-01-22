/**
 * Plan View Header Component
 *
 * Header for the plan view in the control panel.
 * Shows plan name and tab navigation (content/threads).
 * Tab state is managed locally as component state, not through routing.
 */

import { usePlanStore } from "@/entities/plans/store";

interface PlanViewHeaderProps {
  planId: string;
  activeTab: "content" | "threads";
  onTabChange: (tab: "content" | "threads") => void;
}

/**
 * Gets a display name for a plan from its relativePath.
 */
function getPlanDisplayName(plan: { relativePath: string }): string {
  return `plans/${plan.relativePath}`;
}

export function PlanViewHeader({ planId, activeTab, onTabChange }: PlanViewHeaderProps) {
  const plan = usePlanStore((s) => s.getPlan(planId));

  if (!plan) {
    return (
      <div className="px-4 py-3 text-surface-400 border-b border-surface-700">
        Plan not found
      </div>
    );
  }

  const displayName = getPlanDisplayName(plan);

  // TODO: Once relations are implemented, get related thread count
  const relatedThreadCount: number = 0;

  return (
    <div className="border-b border-surface-700">
      <div className="px-4 py-3">
        <h2 className="text-sm font-medium text-surface-100 truncate">
          {displayName}
        </h2>
        <div className="text-xs text-surface-400">
          {relatedThreadCount} related thread{relatedThreadCount !== 1 ? "s" : ""}
        </div>
      </div>
      <div className="flex gap-1 px-3">
        <button
          onClick={() => onTabChange("content")}
          className={`px-3 py-2 text-xs transition-colors ${
            activeTab === "content"
              ? "text-surface-100 border-b-2 border-accent-500"
              : "text-surface-400 hover:text-surface-200"
          }`}
        >
          Content
        </button>
        <button
          onClick={() => onTabChange("threads")}
          className={`px-3 py-2 text-xs transition-colors ${
            activeTab === "threads"
              ? "text-surface-100 border-b-2 border-accent-500"
              : "text-surface-400 hover:text-surface-200"
          }`}
        >
          Threads
        </button>
      </div>
    </div>
  );
}
