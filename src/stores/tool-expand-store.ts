import { create } from 'zustand';

interface ThreadToolState {
  /** Map of toolId -> isExpanded (main expand state) */
  expandedTools: Record<string, boolean>;
  /** Map of toolId -> isOutputExpanded (for bash blocks with long output) */
  expandedOutputs: Record<string, boolean>;
}

interface ToolExpandState {
  /** Map of threadId -> ThreadToolState */
  threads: Record<string, ThreadToolState>;

  /** Set the main expand state for a tool */
  setToolExpanded: (threadId: string, toolId: string, expanded: boolean) => void;
  /** Set the output expand state for a tool (bash blocks with long output) */
  setOutputExpanded: (threadId: string, toolId: string, expanded: boolean) => void;
  /** Get the main expand state for a tool (returns false if not set) */
  isToolExpanded: (threadId: string, toolId: string) => boolean;
  /** Get the output expand state for a tool */
  isOutputExpanded: (threadId: string, toolId: string, defaultValue: boolean) => boolean;

  /** Collapse all tools in a thread */
  collapseAll: (threadId: string) => void;
  /** Expand all tools in a thread */
  expandAll: (threadId: string, toolIds: string[]) => void;
  /** Clear all state for a thread (e.g., when thread is closed) */
  clearThread: (threadId: string) => void;
}

function getOrCreateThreadState(
  threads: Record<string, ThreadToolState>,
  threadId: string
): ThreadToolState {
  return threads[threadId] ?? { expandedTools: {}, expandedOutputs: {} };
}

export const useToolExpandStore = create<ToolExpandState>((set, get) => ({
  threads: {},

  setToolExpanded: (threadId, toolId, expanded) => {
    set((state) => {
      const threadState = getOrCreateThreadState(state.threads, threadId);
      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...threadState,
            expandedTools: {
              ...threadState.expandedTools,
              [toolId]: expanded,
            },
          },
        },
      };
    });
  },

  setOutputExpanded: (threadId, toolId, expanded) => {
    set((state) => {
      const threadState = getOrCreateThreadState(state.threads, threadId);
      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...threadState,
            expandedOutputs: {
              ...threadState.expandedOutputs,
              [toolId]: expanded,
            },
          },
        },
      };
    });
  },

  isToolExpanded: (threadId, toolId) => {
    const state = get();
    return state.threads[threadId]?.expandedTools[toolId] ?? false;
  },

  isOutputExpanded: (threadId, toolId, defaultValue) => {
    const state = get();
    return state.threads[threadId]?.expandedOutputs[toolId] ?? defaultValue;
  },

  collapseAll: (threadId) => {
    set((state) => {
      const threadState = state.threads[threadId];
      if (!threadState) return state;

      // Set all tools to collapsed
      const collapsedTools: Record<string, boolean> = {};
      for (const toolId of Object.keys(threadState.expandedTools)) {
        collapsedTools[toolId] = false;
      }

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...threadState,
            expandedTools: collapsedTools,
          },
        },
      };
    });
  },

  expandAll: (threadId, toolIds) => {
    set((state) => {
      const threadState = getOrCreateThreadState(state.threads, threadId);

      // Set all provided tools to expanded
      const expandedTools: Record<string, boolean> = { ...threadState.expandedTools };
      for (const toolId of toolIds) {
        expandedTools[toolId] = true;
      }

      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...threadState,
            expandedTools,
          },
        },
      };
    });
  },

  clearThread: (threadId) => {
    set((state) => {
      const { [threadId]: _, ...remainingThreads } = state.threads;
      return { threads: remainingThreads };
    });
  },
}));
