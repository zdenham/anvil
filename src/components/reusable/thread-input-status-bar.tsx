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
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ThreadInputStatusBarProps {
  threadId?: string;
  permissionMode: PermissionModeId;
  onCycleMode: () => void;
}

const MODE_COLORS: Record<PermissionModeId, string> = {
  plan: "text-blue-400 hover:text-blue-300",
  implement: "text-green-400 hover:text-green-300",
  approve: "text-amber-400 hover:text-amber-300",
};

const MODE_TOOLTIPS: Record<PermissionModeId, string> = {
  plan: "Read everything, write only to plans/. Bash allowed. Use this to research and plan before making changes.",
  implement: "All tools auto-approved. The agent can read, write, and execute freely without asking.",
  approve: "Reads and Bash auto-approved. File edits require your approval with a diff preview.",
};

export function ThreadInputStatusBar({
  threadId,
  permissionMode,
  onCycleMode,
}: ThreadInputStatusBarProps) {
  const modeDefinition = BUILTIN_MODES[permissionMode];
  const colorClass = MODE_COLORS[permissionMode];
  const tooltip = MODE_TOOLTIPS[permissionMode];

  return (
    <div className="flex items-center justify-between px-1 pb-1 text-xs font-mono">
      {/* Left: Mode label (clickable) with tooltip */}
      <Tooltip
        content={
          <div className="max-w-[240px]">
            <p className="font-semibold">{modeDefinition.name}</p>
            <p className="font-normal mt-0.5">{tooltip}</p>
          </div>
        }
        side="top"
        delayDuration={400}
      >
        <button
          type="button"
          onClick={onCycleMode}
          className={cn(
            "font-medium cursor-pointer transition-colors",
            colorClass,
          )}
        >
          {modeDefinition.name}
          <span className="text-surface-500 ml-1.5">(shift+tab to cycle)</span>
        </button>
      </Tooltip>

      {/* Right: Context meter (only when thread exists) */}
      {threadId && <ContextMeter threadId={threadId} />}
    </div>
  );
}
