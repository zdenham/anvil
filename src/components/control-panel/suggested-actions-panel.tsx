import { useRef, useEffect, forwardRef, useImperativeHandle, useMemo } from "react";
import { Send, ChevronUp, ChevronDown } from "lucide-react";
import { useQuickActionsStore, getActionsForView, type ActionType } from "@/stores/quick-actions-store";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings/service";
import type { ControlPanelViewType } from "@/entities/events";

interface SuggestedActionsPanelProps {
  /** The current view - determines which actions to display */
  view: ControlPanelViewType | null;
  /** @deprecated Use view prop instead - thread ID for backwards compatibility */
  threadId?: string;
  onAction: (action: "markUnread" | "archive") => Promise<void>;
  disabled?: boolean; // Disable during agent execution
  onAutoSelectInput?: () => void; // Callback to focus input when typing
  isStreaming?: boolean; // Whether agent is currently running
  onSubmitFollowUp?: (message: string) => void; // Callback for streaming follow-up messages
  onQuickAction?: (action: ActionType) => void; // Callback for quick actions (keyboard navigation)
}

export interface SuggestedActionsPanelRef {
  focus: () => void;
  expand: () => void;
}

export const SuggestedActionsPanel = forwardRef<SuggestedActionsPanelRef, SuggestedActionsPanelProps>(function SuggestedActionsPanel({
  view,
  onAction,
  disabled = false,
  onAutoSelectInput,
  isStreaming = false,
  onSubmitFollowUp,
  onQuickAction,
}, ref) {
  const panelRef = useRef<HTMLDivElement>(null);
  const followUpInputRef = useRef<HTMLTextAreaElement>(null);

  // Get collapsed state from settings
  const isCollapsed = useSettingsStore((s) => s.workspace.quickActionsCollapsed ?? false);

  const handleToggleCollapse = () => {
    settingsService.set("quickActionsCollapsed", !isCollapsed);
  };

  const handleExpand = () => {
    if (isCollapsed) {
      settingsService.set("quickActionsCollapsed", false);
    }
  };

  // Expose focus and expand methods to parent via ref
  useImperativeHandle(ref, () => ({
    focus: () => panelRef.current?.focus(),
    expand: handleExpand,
  }), [isCollapsed]);

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

  // Choose actions based on view type and streaming state
  const actions = useMemo(
    () => getActionsForView(view, isStreaming),
    [view, isStreaming]
  );

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

  // Don't render if no actions available
  if (actions.length === 0) {
    return null;
  }

  // Render collapsed state
  if (isCollapsed) {
    return (
      <div
        ref={panelRef}
        className="px-4 py-2 bg-surface-900 border-t border-dashed border-surface-700 outline-none"
        tabIndex={-1}
        data-quick-actions-panel
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-surface-400">Quick Actions</h3>
          <button
            onClick={handleToggleCollapse}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Expand quick actions"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="px-4 py-3 bg-surface-900 border-t border-dashed border-surface-700 outline-none"
      tabIndex={-1}
      role="listbox"
      aria-label="Quick actions"
      aria-activedescendant={`action-${selectedIndex}`}
      data-quick-actions-panel
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold text-sm text-surface-200">Quick Actions</h3>
        <button
          onClick={handleToggleCollapse}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Collapse quick actions"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
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
                {action.shortcut && (
                  <span className="ml-auto font-mono text-xs text-surface-500 bg-surface-700 px-1.5 py-0.5 rounded">
                    {action.shortcut}
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