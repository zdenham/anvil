import { useState, useCallback } from "react";
import { ChevronRight, ChevronLeft, MessageSquare } from "lucide-react";
import { ThreadView } from "@/components/thread/thread-view";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
type ThreadStatus = "idle" | "loading" | "running" | "completed" | "error";

interface ChatPaneProps {
  threadId: string | null;
  messages: MessageParam[];
  isStreaming: boolean;
  status: ThreadStatus;
  error?: string;
  onRetry?: () => void;
  /** Control collapse externally (optional - uses internal state if not provided) */
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Width of the chat pane (controlled externally for resizing) */
  width?: number;
  /** Explicit tool states from the agent */
  toolStates?: Record<string, ToolExecutionState>;
}

const DEFAULT_CHAT_PANE_WIDTH = 400;
const COLLAPSED_WIDTH = 40;

/**
 * Collapsible chat pane that displays the agent's thread output.
 * Can be controlled externally or manages its own collapse state.
 */
export function ChatPane({
  threadId,
  messages,
  isStreaming,
  status,
  error,
  onRetry,
  isCollapsed: controlledIsCollapsed,
  onToggleCollapse: controlledOnToggle,
  width = DEFAULT_CHAT_PANE_WIDTH,
  toolStates,
}: ChatPaneProps) {
  // Internal state for uncontrolled mode
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("chatPaneCollapsed");
    return stored === "true";
  });

  // Use controlled or internal state
  const isCollapsed = controlledIsCollapsed ?? internalIsCollapsed;

  const handleToggleCollapse = useCallback(() => {
    if (controlledOnToggle) {
      controlledOnToggle();
    } else {
      setInternalIsCollapsed((prev) => {
        const next = !prev;
        localStorage.setItem("chatPaneCollapsed", String(next));
        return next;
      });
    }
  }, [controlledOnToggle]);

  if (isCollapsed) {
    return (
      <div
        className="h-full flex flex-col border-l border-surface-600 bg-surface-950 flex-shrink-0"
        style={{ width: COLLAPSED_WIDTH }}
      >
        <CollapseButton isCollapsed={true} onClick={handleToggleCollapse} />
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col border-l border-surface-600 bg-surface-950 flex-shrink-0"
      style={{ width }}
    >
      {/* Header with collapse button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="flex items-center gap-2 text-surface-400">
          <MessageSquare size={14} />
          <span className="text-xs font-medium uppercase tracking-wide">
            Agent Output
          </span>
        </div>
        <CollapseButton isCollapsed={false} onClick={handleToggleCollapse} />
      </div>

      {/* Thread content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {threadId ? (
          <ThreadView
            threadId={threadId}
            messages={messages}
            isStreaming={isStreaming}
            status={status}
            error={error}
            onRetry={onRetry}
            toolStates={toolStates}
          />
        ) : (
          <ChatEmptyState />
        )}
      </div>
    </div>
  );
}

interface CollapseButtonProps {
  isCollapsed: boolean;
  onClick: () => void;
}

function CollapseButton({ isCollapsed, onClick }: CollapseButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        p-1.5 rounded-md transition-colors
        text-surface-500 hover:text-surface-300 hover:bg-surface-700/50
        ${isCollapsed ? "mx-auto mt-2" : ""}
      `}
      title={isCollapsed ? "Expand chat pane" : "Collapse chat pane"}
      aria-label={isCollapsed ? "Expand chat pane" : "Collapse chat pane"}
    >
      {isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
    </button>
  );
}

function ChatEmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-surface-500">
      <div className="text-center px-4">
        <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No thread selected</p>
        <p className="text-xs mt-1 text-surface-600">
          Select a thread from the menu to view agent output
        </p>
      </div>
    </div>
  );
}
