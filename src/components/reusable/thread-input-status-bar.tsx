/**
 * ThreadInputStatusBar
 *
 * Below-input status bar showing the current permission mode (clickable)
 * and the context meter (relocated from content-pane-header).
 *
 * Layout:
 *   [Mode label]                    [Context meter]
 */

import type { PermissionModeId } from "@core/types/permissions.js";
import { BUILTIN_MODES } from "@core/types/permissions.js";
import { ContextMeter } from "@/components/content-pane/context-meter";
import { cn } from "@/lib/utils";

interface ThreadInputStatusBarProps {
  threadId: string;
  permissionMode: PermissionModeId;
  onCycleMode: () => void;
}

const MODE_COLORS: Record<PermissionModeId, string> = {
  plan: "text-blue-400 hover:text-blue-300",
  implement: "text-green-400 hover:text-green-300",
  supervise: "text-yellow-400 hover:text-yellow-300",
};

export function ThreadInputStatusBar({
  threadId,
  permissionMode,
  onCycleMode,
}: ThreadInputStatusBarProps) {
  const modeDefinition = BUILTIN_MODES[permissionMode];
  const colorClass = MODE_COLORS[permissionMode];

  return (
    <div className="flex items-center justify-between px-1 pb-1 text-xs">
      {/* Left: Mode label (clickable) */}
      <button
        type="button"
        onClick={onCycleMode}
        className={cn(
          "font-medium cursor-pointer transition-colors",
          colorClass,
        )}
        title={`${modeDefinition.name}: ${modeDefinition.description}. Click or Shift+Tab to cycle.`}
      >
        {modeDefinition.name}
      </button>

      {/* Right: Context meter */}
      <ContextMeter threadId={threadId} />
    </div>
  );
}
