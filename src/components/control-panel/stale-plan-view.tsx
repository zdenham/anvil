/**
 * Stale Plan View Component
 *
 * Displayed when a plan's file cannot be found.
 * Offers options to delete the orphaned metadata.
 */

import { AlertTriangle, Trash2 } from "lucide-react";
import type { PlanMetadata } from "@/entities/plans/types";
import { planService } from "@/entities/plans/service";
import { closeCurrentPanelOrWindow } from "@/lib/panel-navigation";
import { logger } from "@/lib/logger-client";

interface StalePlanViewProps {
  plan: PlanMetadata;
}

/**
 * View shown when a plan file has been moved or deleted.
 * Provides context about the missing file and recovery options.
 */
export function StalePlanView({ plan }: StalePlanViewProps) {
  const handleDelete = async () => {
    try {
      await planService.delete(plan.id);
      await closeCurrentPanelOrWindow();
    } catch (err) {
      logger.error("[StalePlanView] Failed to delete plan:", err);
    }
  };

  const handleDismiss = async () => {
    await closeCurrentPanelOrWindow();
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full">
        {/* Warning header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-full bg-amber-500/10">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-surface-100">
              Plan file not found
            </h2>
            <p className="text-sm text-surface-400">
              This file may have been moved or deleted
            </p>
          </div>
        </div>

        {/* Expected path info */}
        <div className="mb-6 p-3 bg-surface-800 rounded-lg border border-surface-700">
          <div className="text-xs text-surface-400 mb-1">Expected location:</div>
          <code className="text-sm text-surface-200 font-mono break-all">
            {plan.relativePath}
          </code>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleDelete}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors border border-red-500/30"
          >
            <Trash2 className="w-4 h-4" />
            Delete plan metadata
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="px-4 py-2.5 text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded-lg transition-colors"
          >
            Dismiss
          </button>
        </div>

        {/* Help text */}
        <p className="mt-6 text-xs text-surface-500 text-center">
          If you moved the file, it will be detected again when an agent references it.
        </p>
      </div>
    </div>
  );
}
