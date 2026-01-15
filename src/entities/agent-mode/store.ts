import { create } from "zustand";
import type { AgentMode } from "./types.js";
import { getNextMode } from "./types.js";

interface AgentModeState {
  threadModes: Record<string, AgentMode>;
  defaultMode: AgentMode;
}

interface AgentModeActions {
  getMode: (threadId: string) => AgentMode;
  setMode: (threadId: string, mode: AgentMode) => void;
  cycleMode: (threadId: string) => AgentMode;
  setDefaultMode: (mode: AgentMode) => void;
  clearThreadMode: (threadId: string) => void;
}

export const useAgentModeStore = create<AgentModeState & AgentModeActions>(
  (set, get) => ({
    threadModes: {},
    defaultMode: "normal",

    getMode: (threadId: string) => {
      return get().threadModes[threadId] ?? get().defaultMode;
    },

    setMode: (threadId: string, mode: AgentMode) => {
      set((state) => ({
        threadModes: { ...state.threadModes, [threadId]: mode },
      }));
    },

    cycleMode: (threadId: string) => {
      const currentMode = get().getMode(threadId);
      const nextMode = getNextMode(currentMode);
      get().setMode(threadId, nextMode);
      return nextMode;
    },

    setDefaultMode: (mode: AgentMode) => {
      set({ defaultMode: mode });
    },

    clearThreadMode: (threadId: string) => {
      set((state) => {
        const { [threadId]: _, ...rest } = state.threadModes;
        return { threadModes: rest };
      });
    },
  })
);
