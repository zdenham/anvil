import { useState, useEffect, useRef } from "react";
import { Send } from "lucide-react";
import { useNavigateToNextTask } from "@/hooks/use-navigate-to-next-task";
import { logger } from "@/lib/logger-client";

interface SuggestedActionsPanelProps {
  taskId: string;
  threadId: string;
  onAction: (action: "markUnread" | "archive") => Promise<void>;
  disabled?: boolean; // Disable during agent execution
  onAutoSelectInput?: () => void; // Callback to focus input when typing
  isStreaming?: boolean; // Whether agent is currently running
  onSubmitFollowUp?: (message: string) => void; // Callback for streaming follow-up messages
}

type ActionType = "markUnread" | "archive" | "respond" | "nextTask" | "followUp";

interface ActionConfig {
  key: ActionType;
  label: string;
  description?: string;
  number: number;
  icon?: React.ReactNode;
}

const defaultActions: Array<ActionConfig> = [
  { key: "archive", label: "Archive", description: "complete and file away", number: 1 },
  { key: "markUnread", label: "Mark unread", description: "return to inbox for later", number: 2 },
  { key: "respond", label: "Type something to respond", number: 3 },
];

const streamingActions: Array<ActionConfig> = [
  {
    key: "nextTask",
    label: "Go to next task",
    description: "proceed to next unread task",
    number: 1,
  },
  {
    key: "followUp",
    label: "Type something to queue a follow up",
    number: 2,
  },
];

export function SuggestedActionsPanel({
  taskId,
  onAction,
  disabled = false,
  onAutoSelectInput,
  isStreaming = false,
  onSubmitFollowUp,
}: SuggestedActionsPanelProps) {
  const [isProcessing, setIsProcessing] = useState<ActionType | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showFollowUpInput, setShowFollowUpInput] = useState(false);
  const [followUpValue, setFollowUpValue] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const followUpInputRef = useRef<HTMLTextAreaElement>(null);

  // Get the navigation hook for streaming actions
  const { navigateToNextTaskOrFallback } = useNavigateToNextTask(taskId);

  // Choose actions based on streaming state
  const actions = isStreaming ? streamingActions : defaultActions;

  // Auto-focus the panel when it's first rendered and not disabled
  useEffect(() => {
    if (!disabled && panelRef.current) {
      panelRef.current.focus();
    }
  }, [disabled]);

  // Focus follow-up input when it appears
  useEffect(() => {
    if (showFollowUpInput && followUpInputRef.current) {
      followUpInputRef.current.focus();
    }
  }, [showFollowUpInput]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if follow-up input has focus
      const followUpInputFocused = followUpInputRef.current && document.activeElement === followUpInputRef.current;

      // Handle follow-up input keys
      if (followUpInputFocused) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleFollowUpSubmit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setShowFollowUpInput(false);
          setFollowUpValue("");
          panelRef.current?.focus();
        }
        return;
      }

      // Always allow navigation if panel has focus
      const panelHasFocus = panelRef.current && panelRef.current.contains(document.activeElement);

      // For input elements, only respond if they're empty and we're handling navigation keys
      const activeElement = document.activeElement;
      const isInputFocused = activeElement?.tagName === "TEXTAREA" || activeElement?.tagName === "INPUT";
      const inputIsEmpty = isInputFocused && (activeElement as HTMLInputElement | HTMLTextAreaElement)?.value === "";
      const isNavigationKey = e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape";

      // Allow navigation in these cases:
      // 1. Panel has focus
      // 2. Input is focused but empty and we're pressing navigation keys
      // 3. No input is focused
      const shouldHandle = panelHasFocus || (inputIsEmpty && isNavigationKey) || (!isInputFocused && !disabled);

      if (!shouldHandle) {
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        // If input is focused but empty, transfer focus to panel
        if (inputIsEmpty && !panelHasFocus) {
          panelRef.current?.focus();
        }
        const direction = e.key === "ArrowUp" ? -1 : 1;
        setSelectedIndex((prev) => {
          const newIndex = prev + direction;
          return Math.max(0, Math.min(actions.length - 1, newIndex));
        });
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Transfer focus to input
        onAutoSelectInput?.();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selectedAction = actions[selectedIndex];
        if (selectedAction.key === "respond") {
          // Focus the input instead of processing an action
          onAutoSelectInput?.();
        } else {
          handleAction(selectedAction.key);
        }
      } else if (e.key >= "1" && e.key <= "3") {
        e.preventDefault();
        const actionIndex = parseInt(e.key) - 1;
        const selectedAction = actions[actionIndex];
        if (selectedAction) {
          setSelectedIndex(actionIndex);
          if (selectedAction.key === "respond") {
            onAutoSelectInput?.();
          } else {
            handleAction(selectedAction.key);
          }
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Any regular character typed - auto-select input and respond option
        setSelectedIndex(2); // Select the respond option (index 2)
        onAutoSelectInput?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, disabled, onAutoSelectInput, showFollowUpInput]);

  const handleAction = async (action: ActionType) => {
    if (disabled || isProcessing) return;

    // Handle respond action (focus input)
    if (action === "respond") {
      onAutoSelectInput?.();
      return;
    }

    setIsProcessing(action);
    try {
      if (action === "nextTask") {
        await handleGoToNextTask();
      } else if (action === "followUp") {
        setShowFollowUpInput(true);
      } else {
        // Handle default actions (archive, markUnread)
        await onAction(action as "markUnread" | "archive");
      }
    } finally {
      setIsProcessing(null);
    }
  };

  const handleGoToNextTask = async () => {
    try {
      const success = await navigateToNextTaskOrFallback({ actionType: 'quickAction' });
      if (!success) {
        logger.info("[SuggestedActionsPanel] Navigated to tasks panel as fallback");
      }
    } catch (error) {
      logger.error("[SuggestedActionsPanel] Failed to navigate to next task:", error);
    }
  };

  const handleFollowUpSubmit = () => {
    const trimmed = followUpValue.trim();
    if (trimmed && onSubmitFollowUp) {
      onSubmitFollowUp(trimmed);
      setFollowUpValue("");
      setShowFollowUpInput(false);
    }
  };

  const handleClick = (action: ActionType, index: number) => {
    if (disabled || isProcessing) return;

    setSelectedIndex(index);
    if (action === "respond") {
      onAutoSelectInput?.();
    } else {
      handleAction(action);
    }
  };

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      className="px-4 py-3 bg-surface-800 border-t border-surface-700 focus:outline-none focus:ring-1 focus:ring-secondary-500"
      aria-label="Quick actions panel"
      role="listbox"
      aria-activedescendant={`action-${selectedIndex}`}
    >
      <div className="mb-2">
        <h3 className="font-bold text-sm text-surface-200">Quick Actions</h3>
      </div>

      {/* Follow-up input when expanded */}
      {showFollowUpInput && (
        <div className="mb-3 flex gap-2">
          <textarea
            ref={followUpInputRef}
            value={followUpValue}
            onChange={(e) => setFollowUpValue(e.target.value)}
            placeholder="Type follow-up message..."
            className="flex-1 px-3 py-2 text-sm bg-surface-700 border border-surface-600 rounded text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-1 focus:ring-accent-500 resize-none"
            rows={2}
          />
          <button
            onClick={handleFollowUpSubmit}
            disabled={!followUpValue.trim()}
            className="px-3 py-2 rounded bg-accent-600 text-accent-900 hover:bg-accent-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            aria-label="Queue follow-up"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="space-y-1">
        {actions.map((action, index) => {
          const isSelected = selectedIndex === index;
          const isProcessingThis = isProcessing === action.key;
          const isClickable = !disabled && !isProcessing;

          return (
            <div
              key={action.key}
              id={`action-${index}`}
              onClick={() => handleClick(action.key, index)}
              className={`flex items-center gap-2 text-sm ${
                isSelected
                  ? "text-surface-100"
                  : "text-surface-400"
              } ${
                isClickable
                  ? "cursor-pointer hover:text-surface-300"
                  : "cursor-default"
              } ${disabled ? "opacity-50" : ""}`}
              role="option"
              aria-selected={isSelected}
            >
              <span className="text-surface-500 w-2">
                {isSelected ? "›" : " "}
              </span>
              <span className="font-mono text-xs">{action.number}.</span>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {isProcessingThis && (
                  <div className="inline-block w-3 h-3 animate-spin rounded-full border border-surface-400 border-t-surface-200" />
                )}
                {action.icon && (
                  <div className="flex-shrink-0">
                    {action.icon}
                  </div>
                )}
                <span className={isProcessingThis ? "text-surface-300" : ""}>
                  {action.label}
                </span>
                {action.description && (
                  <span className="font-mono text-xs text-surface-500">
                    — {action.description}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}