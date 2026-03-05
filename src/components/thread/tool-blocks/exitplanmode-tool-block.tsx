import { cn } from "@/lib/utils";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { MapPinCheck } from "lucide-react";
import type { ToolBlockProps } from "./index";

interface ParsedExitPlanModeResult {
  status: "approved" | "rejected" | "pending";
  message?: string;
  planId?: string;
}

const MESSAGE_LENGTH_THRESHOLD = 100; // Characters before showing copy button

/**
 * Parse the ExitPlanMode result which may be JSON with status/message fields
 * or a plain string (legacy format).
 */
function parseExitPlanModeResult(
  result: string | undefined
): ParsedExitPlanModeResult {
  if (!result) {
    return { status: "pending" };
  }

  try {
    const parsed = JSON.parse(result);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        status: parsed.status ?? "pending",
        message:
          typeof parsed.message === "string" ? parsed.message : undefined,
        planId:
          typeof parsed.details?.planId === "string"
            ? parsed.details.planId
            : undefined,
      };
    }
  } catch {
    // Fallback: treat plain string as status message
    if (typeof result === "string" && result.trim()) {
      return { status: "approved", message: result.trim() };
    }
  }

  return { status: "pending" };
}

/** Format approval status for display */
function getApprovalStatusLabel(status: string): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "pending":
      return "Pending approval";
    default:
      return "Unknown status";
  }
}

/**
 * Specialized block for rendering ExitPlanMode tool calls.
 * Displays plan exit status and approval information in a clean, minimal interface.
 */
export function ExitPlanModeToolBlock({
  id,
  name: _name,
  input: _input,
  threadId,
}: ToolBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);

  // Parse result - never display raw JSON
  const {
    status: approvalStatus,
    message,
    planId,
  } = parseExitPlanModeResult(result);

  // Manage expand state via Zustand store (persists across virtualization)
  const isExpanded = useToolExpandStore((state) =>
    state.isToolExpanded(threadId, id)
  );
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) =>
    setToolExpanded(threadId, id, expanded);

  const isRunning = status === "running";
  const hasMessage = !!message && message.length > 0;
  const isLongMessage = hasMessage && message.length > MESSAGE_LENGTH_THRESHOLD;

  return (
    <div
      className="group py-0.5"
      aria-label={`Exit plan mode, status: ${approvalStatus}`}
      data-testid={`exitplanmode-tool-${id}`}
      data-tool-status={status}
    >
      {/* Header Row - Always Visible */}
      <div
        className="cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {/* First Line - Description with shimmer animation */}
        {/* Chevron controls expand/collapse - NO icon on this line */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            Exit plan mode
          </ShimmerText>

          {/* Status indicator - only show when not running */}
          {!isRunning && (
            <StatusIcon
              isSuccess={!isError && approvalStatus === "approved"}
            />
          )}

        </div>

        {/* Second Line - Details with icon */}
        {/* Icon ONLY appears on this line (chevron is on first line) */}
        <div className="flex items-center gap-1 mt-0.5">
          <MapPinCheck className="w-3 h-3 text-zinc-500/60 shrink-0" />
          <span
            className={cn(
              "text-xs truncate",
              approvalStatus === "approved" && "text-green-400",
              approvalStatus === "rejected" && "text-red-400",
              approvalStatus === "pending" && "text-zinc-400"
            )}
          >
            {getApprovalStatusLabel(approvalStatus)}
          </span>
        </div>
      </div>

      {/* Expanded Content - Formatted Display (No Raw JSON) */}
      {isExpanded && (
        <div className="mt-2 ml-6">
          <div className="relative">
            {/* Copy button for long messages */}
            {hasMessage && isLongMessage && (
              <div className="absolute top-1 right-1 z-10">
                <CopyButton text={message} label="Copy message" />
              </div>
            )}

            <div className="rounded border border-zinc-700/50 bg-zinc-900/30 p-3">
              {/* Formatted approval details - NOT raw JSON */}
              <div className="space-y-2">
                {/* Status badge */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Status:</span>
                  <span
                    className={cn(
                      "text-xs font-medium px-1.5 py-0.5 rounded",
                      approvalStatus === "approved" &&
                        "bg-green-500/20 text-green-400",
                      approvalStatus === "rejected" &&
                        "bg-red-500/20 text-red-400",
                      approvalStatus === "pending" &&
                        "bg-zinc-500/20 text-zinc-400"
                    )}
                  >
                    {approvalStatus.charAt(0).toUpperCase() +
                      approvalStatus.slice(1)}
                  </span>
                </div>

                {/* Plan ID if available */}
                {planId && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">Plan:</span>
                    <span className="text-xs font-mono text-zinc-300">
                      {planId}
                    </span>
                  </div>
                )}

                {/* Message if available */}
                {hasMessage ? (
                  <div className="mt-2">
                    <span className="text-xs text-zinc-500 block mb-1">
                      Details:
                    </span>
                    <p className="text-xs text-zinc-300 whitespace-pre-wrap break-words">
                      {message}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic">
                    No additional details available
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        Exit plan mode, approval status: {approvalStatus}
        {isRunning && ", currently running"}
        {isError && ", operation failed"}
      </span>
    </div>
  );
}
