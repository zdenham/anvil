import { create } from 'zustand';

export type ActionType = "markUnread" | "archive" | "respond" | "nextTask" | "closeTask" | "followUp";

export interface ActionConfig {
  key: ActionType;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

export const defaultActions: Array<ActionConfig> = [
  { key: "archive", label: "Archive", description: "complete and file away" },
  { key: "markUnread", label: "Mark unread", description: "return to inbox for later" },
  { key: "respond", label: "Type something to respond" },
];

export const streamingActions: Array<ActionConfig> = [
  {
    key: "nextTask",
    label: "Go to next task",
    description: "proceed to next unread task",
  },
  {
    key: "closeTask",
    label: "Close task",
    description: "close this panel",
  },
  {
    key: "followUp",
    label: "Type something to queue a follow up",
  },
];

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