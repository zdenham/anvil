import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Streamdown } from "streamdown";
import { DragHandle } from "./drag-handle";
import { useActionState, type ActionState } from "@/hooks";
import { useTaskStore, useRepoStore } from "@/entities";
import { taskService } from "@/entities/tasks/service";
import { eventBus } from "@/entities/events";
import { agentCommands } from "@/lib/tauri-commands";
import { Send, Loader2, StopCircle, Play, CheckCircle, MessageSquare, ChevronDown } from "lucide-react";
import type { PendingReview, TaskStatus } from "@/entities/tasks/types";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger-client";
import { TriggerSearchInput } from "../reusable/trigger-search-input";
import type { TriggerSearchInputRef, TriggerContext } from "@/lib/triggers/types";

interface ActionPanelProps {
  taskId: string | null;
  threadId: string | null;
  onProgressToNextStep: (nextAgentType: string, defaultMessage: string) => void;
  onStayAndResume: (message: string) => void;
  onTaskComplete: () => void;
  onCancel?: () => void;
}

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 500;
const DEFAULT_HEIGHT = 120;
const REVIEW_DEFAULT_HEIGHT = 280;

/**
 * Fixed bottom action panel with draggable height.
 * Provides context-aware input based on current task/thread state.
 */
export function ActionPanel({
  taskId,
  threadId,
  onProgressToNextStep,
  onStayAndResume,
  onTaskComplete,
  onCancel,
}: ActionPanelProps) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const actionState = useActionState(taskId, threadId);

  // Track height in a ref for the auto-expand effect (avoids stale closure)
  const heightRef = useRef(height);
  heightRef.current = height;

  // Get task data including pending review and status
  const task = useTaskStore((state) =>
    taskId ? state.tasks[taskId] : null
  );
  const latestReview = useMemo(() => {
    const reviews = task?.pendingReviews ?? [];
    return reviews
      .filter((r) => !r.isAddressed)
      .sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null;
  }, [task?.pendingReviews]);
  const taskStatus = task?.status ?? "backlog";
  const reviewApproved = task?.reviewApproved ?? false;
  const prUrl = task?.prUrl ?? null;

  // Auto-expand when a new review arrives (if panel is at default height)
  const lastAutoExpandedReviewIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (latestReview && latestReview.id !== lastAutoExpandedReviewIdRef.current) {
      // New review arrived - expand if panel is at or below default height
      if (heightRef.current <= DEFAULT_HEIGHT) {
        setHeight(REVIEW_DEFAULT_HEIGHT);
      }
      lastAutoExpandedReviewIdRef.current = latestReview.id;
    } else if (!latestReview) {
      // Review cleared - reset so next review can trigger expansion
      lastAutoExpandedReviewIdRef.current = null;
    }
  }, [latestReview]);

  // Listen for action-requested events and refresh task to update local store
  // This is needed because the event may come from a different window (spotlight)
  // where the store update happened, but this window's store is separate
  useEffect(() => {
    const handler = async (payload: { taskId: string; markdown: string; defaultResponse: string }) => {
      // If this event is for our task, refresh it to update our local store
      if (payload.taskId === taskId) {
        await taskService.refreshTask(taskId);
      }
    };
    eventBus.on("action-requested", handler);
    return () => {
      eventBus.off("action-requested", handler);
    };
  }, [taskId]);

  const handleHeightChange = useCallback((delta: number) => {
    setHeight((h) => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, h + delta)));
  }, []);

  const handleDragStart = useCallback(() => setIsDragging(true), []);
  const handleDragEnd = useCallback(() => setIsDragging(false), []);

  return (
    <div
      className={cn(
        "relative border-t border-surface-600 bg-surface-800 flex-shrink-0",
        !isDragging && "transition-[height] duration-200"
      )}
      style={{ height }}
    >
      <DragHandle
        position="top"
        onHeightChange={handleHeightChange}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      />
      <div className="h-full flex flex-col p-3">
        <ActionContent
          state={actionState}
          taskId={taskId}
          latestReview={latestReview}
          taskStatus={taskStatus}
          reviewApproved={reviewApproved}
          prUrl={prUrl}
          onProgressToNextStep={onProgressToNextStep}
          onStayAndResume={onStayAndResume}
          onTaskComplete={onTaskComplete}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}

interface ActionContentProps {
  state: ActionState;
  taskId: string | null;
  latestReview: PendingReview | null;
  taskStatus: TaskStatus;
  reviewApproved: boolean;
  prUrl: string | null;
  onProgressToNextStep: (nextAgentType: string, defaultMessage: string) => void;
  onStayAndResume: (message: string) => void;
  onTaskComplete: () => void;
  onCancel?: () => void;
}

function ActionContent({ state, taskId, latestReview, taskStatus, reviewApproved, prUrl, onProgressToNextStep, onStayAndResume, onTaskComplete, onCancel }: ActionContentProps) {
  const [inputValue, setInputValue] = useState("");
  const [agentTypes, setAgentTypes] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<TriggerSearchInputRef>(null);

  // Get task to find repository name
  const task = useTaskStore((s) => (taskId ? s.tasks[taskId] : null));
  // Get repository for trigger context
  const repo = useRepoStore((s) =>
    task?.repositoryName ? s.repositories[task.repositoryName] : null
  );

  // Build trigger context for file autocomplete
  const triggerContext: TriggerContext = useMemo(
    () => ({
      rootPath: repo?.sourcePath ?? null,
      taskId: taskId ?? undefined,
    }),
    [repo?.sourcePath, taskId]
  );

  // Auto-focus input when entering states that accept input
  useEffect(() => {
    if (state.type !== "streaming") {
      inputRef.current?.focus();
    }
  }, [state.type]);

  // Fetch available agent types on mount
  useEffect(() => {
    agentCommands.getAgentTypes().then(setAgentTypes).catch((err) => {
      logger.error("[ActionPanel] Failed to fetch agent types:", err);
      // Fallback to known types
      setAgentTypes(["research", "execution", "merge"]);
    });
  }, []);

  // Compute the suggested agent based on input state
  const suggestedAgent = inputValue.trim()
    ? latestReview?.onFeedback ?? "execution"
    : latestReview?.onApprove ?? "merge";

  // Use selected agent or fall back to suggestion
  const effectiveAgent = selectedAgent ?? suggestedAgent;

  // Handle pending review submission
  const handleReviewSubmit = useCallback(async () => {
    logger.info("[ActionPanel] handleReviewSubmit called", {
      taskId,
      hasLatestReview: !!latestReview,
      latestReviewMarkdown: latestReview?.markdown?.substring(0, 100),
      latestReviewDefaultResponse: latestReview?.defaultResponse,
      taskStatus,
      reviewApproved,
      inputValue,
      effectiveAgent,
    });

    if (!taskId || !latestReview) {
      logger.warn("[ActionPanel] handleReviewSubmit early return - missing taskId or latestReview", {
        taskId,
        hasLatestReview: !!latestReview,
      });
      return;
    }

    const hasUserFeedback = inputValue.trim() !== "";
    const agentToSpawn = effectiveAgent;
    const message = hasUserFeedback ? inputValue.trim() : latestReview.defaultResponse;

    logger.info("[ActionPanel] Determined action", {
      hasUserFeedback,
      agentToSpawn,
      message: message.substring(0, 100),
    });

    // Mark this specific review as addressed (uses reviewId to identify which one)
    logger.info("[ActionPanel] Marking review as addressed", {
      taskId,
      reviewId: latestReview.id
    });
    await taskService.update(taskId, { addressPendingReview: latestReview.id });
    logger.info("[ActionPanel] Review marked as addressed");

    // Special case: if agent is "done", mark task done instead of spawning
    if (agentToSpawn === "done") {
      logger.info("[ActionPanel] Completing task", { taskId });
      await taskService.update(taskId, { status: "done" });
      onTaskComplete();
      setInputValue("");
      setSelectedAgent(null);
      return;
    }

    // Spawn the selected agent
    logger.info("[ActionPanel] Spawning agent", { agentToSpawn, message });
    onProgressToNextStep(agentToSpawn, message);

    setInputValue("");
    setSelectedAgent(null);
  }, [
    taskId,
    inputValue,
    latestReview,
    taskStatus,
    reviewApproved,
    effectiveAgent,
    onProgressToNextStep,
    onTaskComplete,
  ]);

  const handleReviewKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleReviewSubmit();
      }
    },
    [handleReviewSubmit]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (trimmed) {
        onStayAndResume(trimmed);
        setInputValue("");
      }
    },
    [inputValue, onStayAndResume]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const trimmed = inputValue.trim();
        if (trimmed) {
          onStayAndResume(trimmed);
          setInputValue("");
        }
      }
    },
    [inputValue, onStayAndResume]
  );

  // Determine the button label and color based on selected agent
  const getButtonConfig = () => {
    if (inputValue.trim()) {
      return { label: "Send Feedback", className: "bg-amber-600 hover:bg-amber-500" };
    }
    if (effectiveAgent === "done") {
      return { label: "Complete", className: "bg-green-600 hover:bg-green-500" };
    }
    if (effectiveAgent === "merge") {
      return { label: "Approve & Merge", className: "bg-secondary-600 hover:bg-secondary-500" };
    }
    if (effectiveAgent === "review") {
      return { label: "Send for Review", className: "bg-accent-600 hover:bg-accent-500 text-accent-900" };
    }
    return { label: "Proceed", className: "bg-accent-600 hover:bg-accent-500 text-accent-900" };
  };

  // Get display text for what will happen
  const getNextPhaseDisplay = () => {
    if (effectiveAgent === "done") {
      return <span className="text-green-400">mark task done</span>;
    }
    return (
      <span className="text-accent-400">
        spawn {effectiveAgent} agent
      </span>
    );
  };

  // Pending review mode takes priority
  if (latestReview) {
    const buttonConfig = getButtonConfig();
    return (
      <div className="flex flex-col h-full gap-3 overflow-hidden">
        {/* Markdown content */}
        <div className="flex-1 overflow-auto min-h-0">
          <div className="flex items-start gap-2 text-amber-400 mb-2">
            <MessageSquare size={16} className="mt-0.5 flex-shrink-0" />
            <span className="text-sm font-medium">
              {taskStatus === "in-review" && reviewApproved ? "Merge Result" : "Review Requested"}
            </span>
          </div>
          <div className="text-xs text-surface-400 mb-2">
            Press Enter to {getNextPhaseDisplay()}, or type feedback to request changes.
          </div>
          {/* Display PR URL if available */}
          {prUrl && (
            <div className="text-xs text-surface-400 mb-2">
              <span className="text-surface-500">Pull Request: </span>
              <a
                href={prUrl}
                className="text-accent-400 hover:underline"
              >
                {prUrl}
              </a>
            </div>
          )}
          <div
            className="prose prose-invert prose-sm max-w-none
              prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800
              prose-code:text-amber-400 prose-code:before:content-none prose-code:after:content-none
              prose-a:text-accent-400 prose-a:no-underline hover:prose-a:underline"
          >
            <Streamdown>{latestReview.markdown}</Streamdown>
          </div>
        </div>

        {/* Input field */}
        <div className="flex gap-2 flex-shrink-0">
          <TriggerSearchInput
            ref={inputRef}
            value={inputValue}
            onChange={setInputValue}
            onKeyDown={handleReviewKeyDown}
            placeholder={latestReview.defaultResponse}
            hasContentBelow={false}
            triggerContext={triggerContext}
            autoFocus
            className="flex-1"
          />
          {/* Agent selector dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDropdown(!showDropdown)}
              className="px-3 py-2 rounded-lg bg-surface-700 border border-surface-600 text-surface-300 hover:bg-surface-600 transition-colors flex items-center gap-2 text-sm"
              aria-label="Select agent"
            >
              <span className="capitalize">{effectiveAgent}</span>
              <ChevronDown className="h-4 w-4" />
            </button>
            {showDropdown && (
              <div className="absolute bottom-full mb-1 right-0 bg-surface-800 border border-surface-700 rounded-lg shadow-lg overflow-hidden z-10 min-w-[140px]">
                {[...agentTypes, "done"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setSelectedAgent(type);
                      setShowDropdown(false);
                    }}
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm hover:bg-surface-700 transition-colors capitalize",
                      effectiveAgent === type ? "bg-surface-700 text-accent-400" : "text-surface-300"
                    )}
                  >
                    {type}
                    {type === suggestedAgent && (
                      <span className="text-surface-500 ml-2 text-xs">(suggested)</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleReviewSubmit}
            className={cn(
              "px-4 py-2 rounded-lg text-white transition-colors flex items-center gap-2 text-sm",
              buttonConfig.className
            )}
            aria-label="Submit response"
          >
            <Send className="h-4 w-4" />
            {buttonConfig.label}
          </button>
        </div>
      </div>
    );
  }

  switch (state.type) {
    case "streaming":
      return (
        <div className="flex items-center justify-between h-full">
          <div className="flex items-center gap-3 text-surface-300">
            <Loader2 className="w-5 h-5 animate-spin text-accent-400" />
            <span className="text-sm">Agent is working...</span>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors flex items-center gap-2 text-sm"
            >
              <StopCircle size={16} />
              Cancel
            </button>
          )}
        </div>
      );

    case "completed":
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 text-green-400 mb-3">
            <CheckCircle size={16} />
            <span className="text-sm">Thread complete</span>
          </div>
          <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
            <TriggerSearchInput
              ref={inputRef}
              value={inputValue}
              onChange={setInputValue}
              onKeyDown={handleKeyDown}
              placeholder="Continue the conversation..."
              hasContentBelow={false}
              triggerContext={triggerContext}
              autoFocus
              className="flex-1"
            />
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="px-4 py-2 rounded-lg bg-accent-600 text-accent-900 hover:bg-accent-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      );

    case "awaiting-input":
      return (
        <form onSubmit={handleSubmit} className="flex-1 flex gap-2 h-full">
          <TriggerSearchInput
            ref={inputRef}
            value={inputValue}
            onChange={setInputValue}
            onKeyDown={handleKeyDown}
            placeholder={state.placeholder}
            hasContentBelow={false}
            triggerContext={triggerContext}
            autoFocus
            className="flex-1"
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="px-4 py-2 rounded-lg bg-accent-600 text-accent-900 hover:bg-accent-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      );

    case "review-pending":
      // This case is handled above when latestReview is set.
      // This fallback handles the edge case where action state indicates review
      // but latestReview data is not available.
      return (
        <div className="flex items-center justify-between h-full">
          <div className="flex items-center gap-2 text-amber-400">
            <MessageSquare size={16} />
            <span className="text-sm">Review requested - loading...</span>
          </div>
        </div>
      );

    case "idle":
    default:
      return (
        <form onSubmit={handleSubmit} className="flex-1 flex gap-2 h-full">
          <TriggerSearchInput
            ref={inputRef}
            value={inputValue}
            onChange={setInputValue}
            onKeyDown={handleKeyDown}
            placeholder="What would you like to work on?"
            hasContentBelow={false}
            triggerContext={triggerContext}
            autoFocus
            className="flex-1"
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="px-4 py-2 rounded-lg bg-accent-600 text-accent-900 hover:bg-accent-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end flex items-center gap-2"
            aria-label="Start working"
          >
            <Play className="h-4 w-4" />
            Start
          </button>
        </form>
      );
  }
}
