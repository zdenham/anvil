import { create } from "zustand";
import { eventBus, EventName } from "@/entities/events";
import type { OptimisticStreamPayload } from "@core/types/events.js";

interface StreamingBlock {
  type: "text" | "thinking";
  content: string;
}

interface StreamingState {
  /** Optimistic (ephemeral) streaming content, keyed by threadId. NOT persisted. */
  activeStreams: Record<string, {
    blocks: StreamingBlock[];
  }>;
}

interface StreamingActions {
  setStream: (payload: OptimisticStreamPayload) => void;
  clearStream: (threadId: string) => void;
}

export const useStreamingStore = create<StreamingState & StreamingActions>((set) => ({
  activeStreams: {},

  setStream: ({ threadId, blocks }) => set((state) => ({
    activeStreams: {
      ...state.activeStreams,
      [threadId]: { blocks },
    },
  })),

  clearStream: (threadId) => set((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [threadId]: _, ...rest } = state.activeStreams;
    return { activeStreams: rest };
  }),
}));

export function setupStreamingListeners(): void {
  eventBus.on(EventName.OPTIMISTIC_STREAM, (payload) => {
    useStreamingStore.getState().setStream(payload);
  });

  eventBus.on(EventName.AGENT_STATE, ({ threadId }) => {
    useStreamingStore.getState().clearStream(threadId);
  });

  eventBus.on(EventName.AGENT_COMPLETED, ({ threadId }) => {
    useStreamingStore.getState().clearStream(threadId);
  });

  eventBus.on(EventName.AGENT_CANCELLED, ({ threadId }) => {
    useStreamingStore.getState().clearStream(threadId);
  });
}
