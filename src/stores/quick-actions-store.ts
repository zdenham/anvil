import { create } from 'zustand';

export type ActionType = "markUnread" | "archive" | "respond" | "nextTask" | "followUp";

export interface ActionConfig {
  key: ActionType;
  label: string;
  description?: string;
  number: number;
  icon?: React.ReactNode;
}

export const defaultActions: Array<ActionConfig> = [
  { key: "archive", label: "Archive", description: "complete and file away", number: 1 },
  { key: "markUnread", label: "Mark unread", description: "return to inbox for later", number: 2 },
  { key: "respond", label: "Type something to respond", number: 3 },
];

export const streamingActions: Array<ActionConfig> = [
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

  navigateUp: (actionsLength) => set((state) => ({
    selectedIndex: Math.max(0, state.selectedIndex - 1)
  })),

  navigateDown: (actionsLength) => set((state) => ({
    selectedIndex: Math.min(actionsLength - 1, state.selectedIndex + 1)
  })),
}));