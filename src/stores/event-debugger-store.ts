import { create } from "zustand";
import { logger } from "@/lib/logger-client";

// ============================================================================
// Types
// ============================================================================

export interface CapturedEvent {
  id: number;
  timestamp: number;
  emittedAt: number | null;
  threadId: string;
  senderId: string;
  type: string;
  name?: string;
  source?: string;
  payload: unknown;
  pipeline?: Array<{ stage: string; seq?: number; ts: number }>;
  size: number;
}

interface EventDebuggerFilters {
  types: Set<string>;
  threadId: string | null;
  search: string;
}

interface EventDebuggerState {
  events: CapturedEvent[];
  isCapturing: boolean;
  isReplaying: boolean;
  replayState: "idle" | "playing" | "paused";
  replayIndex: number;
  replaySpeed: number;
  replayTimerId: number | null;
  maxEvents: number;
  filters: EventDebuggerFilters;
  selectedEventId: number | null;

  diskState: Record<string, unknown> | null;
  diskStateThreadId: string | null;
  diskStateLoading: boolean;
}

interface EventDebuggerActions {
  captureEvent: (msg: Record<string, unknown>) => void;
  toggleCapture: () => void;
  clearEvents: () => void;
  setFilter: (key: string, value: unknown) => void;
  selectEvent: (id: number | null) => void;
  setDiskState: (threadId: string, state: Record<string, unknown>) => void;
  setDiskStateLoading: (loading: boolean) => void;
  filteredEvents: () => CapturedEvent[];
  startReplay: () => Promise<void>;
  pauseReplay: () => void;
  resumeReplay: () => void;
  stepForward: () => void;
  setReplaySpeed: (speed: number) => void;
  stopReplay: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

let nextId = 1;

function computeSize(msg: unknown): number {
  try {
    return JSON.stringify(msg).length;
  } catch {
    return 0;
  }
}

function extractName(msg: Record<string, unknown>): string | undefined {
  if (typeof msg.name === "string") return msg.name;
  if (typeof msg.event === "string") return msg.event;
  return undefined;
}

function extractPipeline(
  msg: Record<string, unknown>,
): Array<{ stage: string; seq?: number; ts: number }> | undefined {
  if (!Array.isArray(msg.pipeline)) return undefined;
  return msg.pipeline as Array<{ stage: string; seq?: number; ts: number }>;
}

function matchesSearch(event: CapturedEvent, search: string): boolean {
  const lower = search.toLowerCase();
  if (event.name?.toLowerCase().includes(lower)) return true;
  if (event.type.toLowerCase().includes(lower)) return true;
  if (event.threadId.toLowerCase().includes(lower)) return true;
  if (event.source?.toLowerCase().includes(lower)) return true;
  try {
    const payloadStr = JSON.stringify(event.payload).toLowerCase();
    return payloadStr.includes(lower);
  } catch {
    return false;
  }
}

// ============================================================================
// Store
// ============================================================================

export const useEventDebuggerStore = create<
  EventDebuggerState & EventDebuggerActions
>((set, get) => ({
  events: [],
  isCapturing: false,
  isReplaying: false,
  replayState: "idle" as const,
  replayIndex: 0,
  replaySpeed: 1,
  replayTimerId: null,
  maxEvents: 500,
  filters: {
    types: new Set<string>(),
    threadId: null,
    search: "",
  },
  selectedEventId: null,

  diskState: null,
  diskStateThreadId: null,
  diskStateLoading: false,

  captureEvent: (msg: Record<string, unknown>) => {
    const state = get();
    if (!state.isCapturing) return;

    const pipeline = extractPipeline(msg);
    const captured: CapturedEvent = {
      id: nextId++,
      timestamp: Date.now(),
      emittedAt: pipeline?.find((s) => s.stage === "agent:sent")?.ts ?? null,
      threadId: String(msg.threadId ?? ""),
      senderId: String(msg.senderId ?? ""),
      type: String(msg.type ?? "unknown"),
      name: extractName(msg),
      source: typeof msg.source === "string" ? msg.source : undefined,
      payload: msg,
      pipeline,
      size: computeSize(msg),
    };

    set((prev) => {
      const updated = [...prev.events, captured];
      if (updated.length > prev.maxEvents) {
        return { events: updated.slice(updated.length - prev.maxEvents) };
      }
      return { events: updated };
    });
  },

  toggleCapture: () => {
    const next = !get().isCapturing;
    logger.info(`[event-debugger] Capture ${next ? "started" : "stopped"}`);
    set({ isCapturing: next });
  },

  clearEvents: () => {
    logger.info("[event-debugger] Events cleared");
    set({ events: [], selectedEventId: null });
  },

  setFilter: (key: string, value: unknown) => {
    set((prev) => {
      const filters = { ...prev.filters };
      switch (key) {
        case "types":
          filters.types = value as Set<string>;
          break;
        case "threadId":
          filters.threadId = value as string | null;
          break;
        case "search":
          filters.search = value as string;
          break;
      }
      return { filters };
    });
  },

  selectEvent: (id: number | null) => {
    set({ selectedEventId: id });
  },

  setDiskState: (threadId: string, state: Record<string, unknown>) => {
    set({
      diskState: state,
      diskStateThreadId: threadId,
      diskStateLoading: false,
    });
  },

  setDiskStateLoading: (loading: boolean) => {
    set({ diskStateLoading: loading });
  },

  filteredEvents: () => {
    const state = get();
    const { types, threadId, search } = state.filters;

    return state.events.filter((event) => {
      if (types.size > 0 && !types.has(event.type)) return false;
      if (threadId && event.threadId !== threadId) return false;
      if (search && !matchesSearch(event, search)) return false;
      return true;
    });
  },

  startReplay: async () => {
    const state = get();
    const threadId = state.filters.threadId;
    if (!threadId) return;

    // Clear thread state before replay (lazy import to avoid circular dep)
    const { clearThreadStateForReplay } = await import("@/lib/replay-utils");
    clearThreadStateForReplay(threadId);

    set({ isReplaying: true, replayState: "playing", replayIndex: 0 });
    scheduleNextReplayTick(get, set);
  },

  pauseReplay: () => {
    const state = get();
    if (state.replayTimerId !== null) {
      window.clearTimeout(state.replayTimerId);
    }
    set({ replayState: "paused", replayTimerId: null });
  },

  resumeReplay: () => {
    set({ replayState: "playing" });
    scheduleNextReplayTick(get, set);
  },

  stepForward: async () => {
    const state = get();
    // Pause if playing
    if (state.replayTimerId !== null) {
      window.clearTimeout(state.replayTimerId);
    }
    set({ replayState: "paused", replayTimerId: null });
    await dispatchReplayTick(get, set);
  },

  setReplaySpeed: (speed: number) => {
    set({ replaySpeed: speed });
  },

  stopReplay: () => {
    const state = get();
    if (state.replayTimerId !== null) {
      window.clearTimeout(state.replayTimerId);
    }
    set({
      isReplaying: false,
      replayState: "idle",
      replayIndex: 0,
      replayTimerId: null,
    });
  },
}));

// ============================================================================
// Replay Scheduling Helpers
// ============================================================================

type StoreGet = () => EventDebuggerState & EventDebuggerActions;
type StoreSet = (partial: Partial<EventDebuggerState>) => void;

async function dispatchReplayTick(get: StoreGet, set: StoreSet): Promise<void> {
  const { replayEvent } = await import("@/lib/event-replayer");
  const state = get();
  const events = state.filteredEvents();

  if (state.replayIndex >= events.length) {
    set({ isReplaying: false, replayState: "idle", replayTimerId: null });
    return;
  }

  const event = events[state.replayIndex];
  replayEvent(event);
  set({ replayIndex: state.replayIndex + 1 });
}

function scheduleNextReplayTick(get: StoreGet, set: StoreSet): void {
  const state = get();
  const events = state.filteredEvents();

  if (state.replayState !== "playing") return;
  if (state.replayIndex >= events.length) {
    set({ isReplaying: false, replayState: "idle", replayTimerId: null });
    return;
  }

  // Compute delay from emittedAt deltas between consecutive events
  let delayMs = 0;
  if (state.replayIndex > 0) {
    const prev = events[state.replayIndex - 1];
    const curr = events[state.replayIndex];
    const prevTs = prev.emittedAt ?? prev.timestamp;
    const currTs = curr.emittedAt ?? curr.timestamp;
    delayMs = Math.max(0, (currTs - prevTs) / state.replaySpeed);
  }

  // Cap delay to avoid very long waits
  delayMs = Math.min(delayMs, 2000 / state.replaySpeed);

  const timerId = window.setTimeout(async () => {
    await dispatchReplayTick(get, set);
    scheduleNextReplayTick(get, set);
  }, delayMs);

  set({ replayTimerId: timerId });
}
