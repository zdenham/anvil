import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Send } from "lucide-react";
import { useQuickActionsStore, defaultActions, streamingActions, type ActionType } from "@/stores/quick-actions-store";

interface SuggestedActionsPanelProps {
  threadId: string;
  onAction: (action: "markUnread" | "archive") => Promise<void>;
  disabled?: boolean; // Disable during agent execution
  onAutoSelectInput?: () => void; // Callback to focus input when typing
  isStreaming?: boolean; // Whether agent is currently running
  onSubmitFollowUp?: (message: string) => void; // Callback for streaming follow-up messages
  onQuickAction?: (action: ActionType) => void; // Callback for quick actions (keyboard navigation)
}

export interface SuggestedActionsPanelRef {
  focus: () => void;
}

export const SuggestedActionsPanel = forwardRef<SuggestedActionsPanelRef, SuggestedActionsPanelProps>(function SuggestedActionsPanel({
  onAction,
  disabled = false,
  onAutoSelectInput,
  isStreaming = false,
  onSubmitFollowUp,
  onQuickAction,
}, ref) {
  const panelRef = useRef<HTMLDivElement>(null);
  const followUpInputRef = useRef<HTMLTextAreaElement>(null);

  // Expose focus method to parent via ref
  useImperativeHandle(ref, () => ({
    focus: () => panelRef.current?.focus(),
  }), []);

  // Get state from the store
  const {
    selectedIndex,
    showFollowUpInput,
    followUpValue,
    isProcessing,
    setSelectedIndex,
    setShowFollowUpInput,
    setFollowUpValue,
  } = useQuickActionsStore();

  // Choose actions based on streaming state
  const actions = isStreaming ? streamingActions : defaultActions;

  // Focus follow-up input when it appears
  useEffect(() => {
    if (showFollowUpInput && followUpInputRef.current) {
      followUpInputRef.current.focus();
    }
  }, [showFollowUpInput]);

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
    } else if (action === "markUnread" || action === "archive") {
      // Handle legacy actions through the old interface
      onAction(action);
    } else if (onQuickAction) {
      // Handle new actions through the quick action callback
      onQuickAction(action);
    }
  };

  return (
    <div
      ref={panelRef}
      className="px-4 py-3 bg-surface-800 border-t border-surface-700 outline-none"
      tabIndex={-1}
      role="listbox"
      aria-label="Quick actions"
      aria-activedescendant={`action-${selectedIndex}`}
      data-quick-actions-panel
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleFollowUpSubmit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setShowFollowUpInput(false);
                setFollowUpValue("");
              }
            }}
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
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {action.icon && (
                  <div className="flex-shrink-0">
                    {action.icon}
                  </div>
                )}
                <span>
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
});