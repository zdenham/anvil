import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { ControlPanelViewType } from "@/entities/events";

export type ActionType = "markUnread" | "archive" | "respond" | "nextItem" | "closePanel" | "followUp" | "createThread" | "editPlan" | "deletePlan" | "toggleView";

export interface ActionConfig {
  key: ActionType;
  label: string;
  description?: string;
  icon?: ReactNode;
  shortcut?: string;
}

// Thread view default actions
export const threadDefaultActions: Array<ActionConfig> = [
  { key: "archive", label: "Archive", description: "complete and file away" },
  { key: "markUnread", label: "Mark unread", description: "return to inbox for later" },
  { key: "respond", label: "Type something to respond" },
];

// Thread view streaming actions
export const threadStreamingActions: Array<ActionConfig> = [
  {
    key: "nextItem",
    label: "Next unread",
    description: "proceed to next unread item",
  },
  {
    key: "closePanel",
    label: "Close",
    description: "close this panel",
  },
  {
    key: "followUp",
    label: "Type something to queue a follow up",
  },
];

// Plan view actions
export const planDefaultActions: Array<ActionConfig> = [
  { key: "createThread", label: "Create Thread", description: "start a new thread for this plan", shortcut: "\u2318N" },
  { key: "editPlan", label: "Edit Plan", description: "modify plan content", shortcut: "\u2318E" },
  { key: "deletePlan", label: "Delete Plan", description: "remove this plan", shortcut: "\u2318\u232B" },
];

// Legacy aliases for backwards compatibility
export const defaultActions = threadDefaultActions;
export const streamingActions = threadStreamingActions;

/**
 * Get the appropriate actions for a given view type and streaming state.
 */
export function getActionsForView(
  view: ControlPanelViewType | null,
  isStreaming: boolean = false
): Array<ActionConfig> {
  if (!view) return [];

  if (view.type === "plan") {
    return planDefaultActions;
  }

  // Thread view
  return isStreaming ? threadStreamingActions : threadDefaultActions;
}

interface QuickActionsState {
  selectedIndex: number;
  showFollowUpInput: boolean;
  followUpValue: string;
  isProcessing: ActionType | null;

  // Actions
  setSelectedIndex: (index: number) => void;
  setShowFollowUpInput: (show: boolean) => void;
  setFollowUpValue: (value: string) => void;
  setProcessing: (action: ActionType | null) => void;
  resetState: () => void;

  // Navigation helpers
  navigateUp: (actionsLength: number) => void;
  navigateDown: (actionsLength: number) => void;
}

export const useQuickActionsStore = create<QuickActionsState>((set) => ({
  selectedIndex: 0,
  showFollowUpInput: false,
  followUpValue: "",
  isProcessing: null,

  setSelectedIndex: (index) => set({ selectedIndex: index }),
  setShowFollowUpInput: (show) => set({ showFollowUpInput: show }),
  setFollowUpValue: (value) => set({ followUpValue: value }),
  setProcessing: (action) => set({ isProcessing: action }),

  resetState: () => set({
    selectedIndex: 0,
    showFollowUpInput: false,
    followUpValue: "",
    isProcessing: null,
  }),

  navigateUp: (_actionsLength) => set((state) => ({
    selectedIndex: Math.max(0, state.selectedIndex - 1)
  })),

  navigateDown: (actionsLength) => set((state) => ({
    selectedIndex: Math.min(actionsLength - 1, state.selectedIndex + 1)
  })),
}));