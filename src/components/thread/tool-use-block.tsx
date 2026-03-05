import { useCallback, useEffect, useRef } from "react";
import {
  FileText,
  Pencil,
  Terminal,
  Search,
  Globe,
  GitBranch,
  Wrench,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getToolDisplayName } from "@/lib/utils/tool-icons";
import { formatToolInput } from "@/lib/utils/tool-formatters";
import { InlineDiffBlock } from "./inline-diff-block";
import { useToolDiff } from "./use-tool-diff";
import { useToolState } from "@/hooks/use-tool-state";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { usePermissionStore } from "@/entities/permissions/store";
import { InlinePermissionApproval } from "./inline-permission-approval";

interface ToolUseBlockProps {
  /** Unique tool use ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Callback when user wants to expand diff to full viewer */
  onOpenDiff?: (filePath: string) => void;
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
}

// Tool name to icon mapping
const TOOL_ICONS: Record<string, typeof Wrench> = {
  read: FileText,
  write: Pencil,
  edit: Pencil,
  bash: Terminal,
  grep: Search,
  glob: Search,
  webfetch: Globe,
  websearch: Globe,
  task: GitBranch,
  agent: GitBranch,
};

function getToolIconComponent(toolName: string) {
  const normalized = toolName.toLowerCase();
  for (const [pattern, Icon] of Object.entries(TOOL_ICONS)) {
    if (normalized.includes(pattern)) {
      return Icon;
    }
  }
  return Wrench;
}

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

/**
 * Generic tool block using the modern two-line layout with shimmer effects.
 * Used for tools not in the specialized registry.
 * Shows inline permission approval UI when a pending request exists.
 */
export function ToolUseBlock({
  id,
  name,
  input,
  onOpenDiff,
  threadId,
}: ToolUseBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);

  // Use Zustand store for expand state to persist across virtualization remounts
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Check for pending permission request for this tool use
  const permissionRequest = usePermissionStore(
    useCallback((s) => s.getRequestByToolUseId(id), [id]),
  );
  const hasPendingPermission = permissionRequest?.status === "pending";

  // Auto-expand when a permission request arrives
  const prevHadPermission = useRef(false);
  useEffect(() => {
    if (hasPendingPermission && !prevHadPermission.current) {
      setToolExpanded(threadId, id, true);
    }
    prevHadPermission.current = !!hasPendingPermission;
  }, [hasPendingPermission, setToolExpanded, threadId, id]);

  const Icon = getToolIconComponent(name);
  const displayName = getToolDisplayName(name);
  const formatted = formatToolInput(name, input);
  const diffData = useToolDiff(name, input, result);

  const isRunning = status === "running";
  const hasResult = result !== undefined && result.length > 0;
  const isLongOutput = hasResult && result!.split("\n").length > LINE_COLLAPSE_THRESHOLD;

  // Output expand state
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  // Force expanded when permission pending
  const effectiveExpanded = isExpanded || hasPendingPermission;

  return (
    <div
      className={cn(
        "group py-0.5",
        hasPendingPermission && "rounded-lg border border-amber-500/50 bg-amber-950/10 p-2"
      )}
      aria-label={`Tool: ${displayName}, status: ${hasPendingPermission ? "awaiting approval" : status}`}
      data-testid={`tool-use-${id}`}
      data-tool-status={hasPendingPermission ? "pending_approval" : status}
    >
      {/* Clickable Header - Two Line Layout */}
      <div
        className="cursor-pointer select-none"
        onClick={() => setIsExpanded(!effectiveExpanded)}
        role="button"
        aria-expanded={effectiveExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!effectiveExpanded);
          }
        }}
      >
        {/* Line 1: Display name with shimmer + duration/status */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={effectiveExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            {isRunning ? `Running ${displayName.toLowerCase()}` : displayName}
          </ShimmerText>

          {/* Right side: permission and error indicators */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {hasPendingPermission ? (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            ) : (
              isError && !isRunning && <StatusIcon isSuccess={false} />
            )}
          </span>
        </div>

        {/* Line 2: Icon + formatted input summary */}
        <div className="flex items-center gap-1 mt-0.5">
          <Icon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="text-xs text-zinc-500 truncate">
            {formatted.primary}
            {formatted.secondary && (
              <span className="ml-1 text-zinc-600">{formatted.secondary}</span>
            )}
          </span>
        </div>
      </div>

      {/* Expanded Content */}
      {effectiveExpanded && (
        <div className="mt-2 space-y-2">
          {/* Inline permission approval UI */}
          {hasPendingPermission && permissionRequest && (
            <InlinePermissionApproval
              request={permissionRequest}
              name={name}
            />
          )}

          {/* Inline diff display for Edit/Write tools (when NOT in permission flow) */}
          {!hasPendingPermission && diffData && (
            <InlineDiffBlock
              filePath={diffData.filePath}
              diff={diffData.diff}
              lines={diffData.lines}
              stats={diffData.stats}
              onExpand={() => onOpenDiff?.(diffData.filePath)}
            />
          )}

          {/* Output section */}
          {!hasPendingPermission && hasResult && (
            <CollapsibleOutputBlock
              isExpanded={isOutputExpanded}
              onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
              isLongContent={isLongOutput}
              maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
              variant={isError ? "error" : "default"}
            >
              <pre
                className={cn(
                  "text-xs p-3 whitespace-pre-wrap break-words",
                  isError ? "text-red-200" : "text-zinc-300"
                )}
              >
                <code>{result}</code>
              </pre>
            </CollapsibleOutputBlock>
          )}
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {hasPendingPermission
          ? "Awaiting approval"
          : isRunning
            ? "In progress"
            : isError
              ? "Failed"
              : "Completed"}
      </span>
    </div>
  );
}
