import { create } from "zustand";
import { eventBus, EventName } from "@/entities/events";
import type { OptimisticStreamPayload, StreamDeltaPayload } from "@core/types/events.js";
import { logger } from "@/lib/logger-client.js";
import { diskReadStats } from "@/stores/disk-read-stats.js";

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
  applyDelta: (payload: StreamDeltaPayload) => void;
  clearStream: (threadId: string) => void;
}

/** Tracks the last applied stream event ID per thread for chain gap detection. */
const lastStreamEventId: Record<string, string> = {};

export const useStreamingStore = create<StreamingState & StreamingActions>((set) => ({
  activeStreams: {},

  setStream: ({ threadId, blocks }) => set((state) => ({
    activeStreams: {
      ...state.activeStreams,
      [threadId]: { blocks },
    },
  })),

  applyDelta: ({ id, previousEventId, threadId, deltas, full }) => set((state) => {
    if (previousEventId === null || !lastStreamEventId[threadId]) {
      // Full sync — first event, process restart, or no base state
      if (full) {
        lastStreamEventId[threadId] = id;
        return { activeStreams: { ...state.activeStreams, [threadId]: { blocks: full } } };
      }
      return state;
    }

    if (previousEventId !== lastStreamEventId[threadId]) {
      // Gap detected — clear stream; next emission with previousEventId: null will resync
      logger.warn(`[streaming-store] STREAM_DELTA CHAIN GAP for ${threadId}: expected=${lastStreamEventId[threadId]}, got previousEventId=${previousEventId} — clearing stream`);
      diskReadStats.recordStreamGap(threadId);
      delete lastStreamEventId[threadId];
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [threadId]: _, ...rest } = state.activeStreams;
      return { activeStreams: rest };
    }

    // Chain intact — apply appends
    const existing = state.activeStreams[threadId];
    if (!existing) return state;

    const blocks = [...existing.blocks];
    for (const delta of deltas) {
      if (blocks[delta.index]) {
        blocks[delta.index] = {
          ...blocks[delta.index],
          content: blocks[delta.index].content + delta.append,
        };
      } else {
        // New block appeared
        blocks[delta.index] = { type: delta.type, content: delta.append };
      }
    }

    lastStreamEventId[threadId] = id;
    return { activeStreams: { ...state.activeStreams, [threadId]: { blocks } } };
  }),

  clearStream: (threadId) => set((state) => {
    delete lastStreamEventId[threadId];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [threadId]: _, ...rest } = state.activeStreams;
    return { activeStreams: rest };
  }),
}));

export function setupStreamingListeners(): void {
  // Legacy full-snapshot listener (deprecated — kept for backwards compat)
  eventBus.on(EventName.OPTIMISTIC_STREAM, (payload) => {
    useStreamingStore.getState().setStream(payload);
  });

  // Delta-based streaming listener
  eventBus.on(EventName.STREAM_DELTA, (payload) => {
    useStreamingStore.getState().applyDelta(payload);
  });

  // NOTE: AGENT_STATE and AGENT_COMPLETED clearing is handled in listeners.ts
  // AFTER loadThreadState resolves, to avoid a flash of empty content.

  eventBus.on(EventName.AGENT_CANCELLED, ({ threadId }) => {
    useStreamingStore.getState().clearStream(threadId);
  });
}
