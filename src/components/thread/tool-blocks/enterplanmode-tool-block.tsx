import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { StatusIcon } from "@/components/ui/status-icon";
import { Map } from "lucide-react";
import type { ToolBlockProps } from "./index";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";

/**
 * EnterPlanMode tool block - renders when agent enters plan mode.
 *
 * Layout:
 * - First line: Chevron + description text (with shimmer when running)
 * - Second line: Icon + status indicator
 *
 * API shape:
 * - Input: Empty object (no parameters)
 * - Result: Plain string message (e.g., "Plan mode entered successfully")
 *
 * This tool uses the standard Anthropic tool use protocol:
 * - ToolUseBlock: { id, name: "EnterPlanMode", input: {}, type: "tool_use" }
 * - ToolResultBlockParam: { tool_use_id, type: "tool_result", content: string }
 */
export function EnterPlanModeToolBlock({
  id,
  name: _name,
  input: _input, // Empty object, not used
  threadId,
}: ToolBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);

  // Use Zustand store for expand state to persist across virtualization remounts
  const isExpanded = useToolExpandStore((state) =>
    state.isToolExpanded(threadId, id)
  );
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Result is a plain string message (not JSON)
  const statusMessage = result?.trim() || "Plan mode entered";

  const isRunning = status === "running";
  const isComplete = status === "complete";

  // Build the header content with two-line layout
  const header = (
    <div className="flex flex-col gap-1">
      {/* First line: Chevron + description text (shimmer when running) */}
      <div className="flex items-center gap-2">
        <ExpandChevron isExpanded={isExpanded} size="md" />
        <ShimmerText
          isShimmering={isRunning}
          className="text-sm text-zinc-200"
        >
          {isRunning ? "Entering plan mode" : "Enter plan mode"}
        </ShimmerText>
      </div>

      {/* Second line: Icon + status indicator (icon ONLY on this line) */}
      <div className="flex items-center gap-1 mt-0.5">
        <Map className="w-4 h-4 text-zinc-500 shrink-0" />
        {isComplete && !isError && (
          <StatusIcon isSuccess={true} size="sm" />
        )}
        {isError && (
          <StatusIcon isSuccess={false} size="sm" />
        )}
      </div>
    </div>
  );

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      header={header}
      testId={`enterplanmode-tool-${id}`}
      ariaLabel="Enter plan mode tool"
      className="py-0.5"
    >
      {/* Expanded Section: Status Message (formatted, not raw JSON) */}
      <div className="mt-2 ml-6 p-2 rounded border border-zinc-700/50 bg-zinc-900/30">
        <p className="text-xs text-zinc-400">{statusMessage}</p>
      </div>
    </CollapsibleBlock>
  );
}
