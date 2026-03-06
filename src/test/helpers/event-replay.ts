/**
 * Event Replay Harness for UI isolation tests.
 *
 * Replays captured events through the real production pipeline:
 *   routeAgentMessage() → eventBus → listeners → threadService → store → React
 *
 * Only the filesystem (Tauri invoke) is mocked. Everything else is real.
 */

import { routeAgentMessage } from "@/lib/agent-service";
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events";
import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer";
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import { VirtualFS } from "./virtual-fs";
import { MOCK_MORT_DIR } from "../mocks/tauri-api";
import { waitForReact } from "./event-emitter";
import type { CapturedEvent } from "@/stores/event-debugger-store";
import type { ThreadState } from "@core/types/events";

/**
 * Flush all pending async work from fire-and-forget mitt listeners.
 *
 * Mitt calls async handlers synchronously and discards the returned Promise.
 * Each setTimeout(0) runs as a macrotask AFTER all pending microtasks drain,
 * letting cascading await chains (refreshById → invoke → parse → store) fully
 * resolve within one round. Multiple rounds handle macrotask-scheduled work
 * (e.g. store.markThreadAsUnread uses setTimeout internally).
 */
async function flushAsyncListeners(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

// ============================================================================
// ReplayHarness
// ============================================================================

/**
 * Replays captured events through the real production pipeline.
 *
 * Pre-computes what the agent would have written to disk (by reducing
 * thread_actions through threadReducer), seeds the virtual filesystem,
 * then feeds every event through routeAgentMessage() — the same entry
 * point as live socket messages.
 *
 * The routing, eventBus, listeners, service layer, store, and machine
 * are all real. Only the filesystem (invoke) is virtual.
 */
export class ReplayHarness {
  private events: CapturedEvent[];
  private threadId: string;
  private diskState: ThreadState;
  private diskMetadata: Record<string, unknown>;

  constructor(rawEvents: CapturedEvent[]) {
    this.events = deduplicateEvents(rawEvents);
    this.threadId = this.events[0]?.threadId ?? "";
    this.diskState = this.buildDiskState();
    this.diskMetadata = this.buildDiskMetadata();
    this.seedVirtualDisk();
  }

  /** Reduce thread_action payloads → what agent wrote to state.json */
  private buildDiskState(): ThreadState {
    let state: ThreadState = {
      messages: [],
      fileChanges: [],
      workingDirectory: "",
      status: "running",
      timestamp: 0,
      toolStates: {},
    };
    for (const event of this.events) {
      if (event.type === "thread_action") {
        const payload = event.payload as Record<string, unknown>;
        if (payload?.action) {
          state = threadReducer(state, payload.action as ThreadAction);
        }
      }
    }
    return state;
  }

  /** Extract metadata from named events → what agent wrote to metadata.json */
  private buildDiskMetadata(): Record<string, unknown> {
    const now = Date.now();
    const meta: Record<string, unknown> = {
      id: this.threadId,
      repoId: "00000000-0000-4000-a000-000000000001",
      worktreeId: "00000000-0000-4000-a000-000000000002",
      status: "running",
      createdAt: this.events[0]?.timestamp ?? now,
      updatedAt: now,
      isRead: true,
      turns: [{ index: 0, prompt: "", startedAt: this.events[0]?.timestamp ?? now, completedAt: null }],
    };

    for (const event of this.events) {
      if (event.type !== "event") continue;
      const payload = event.payload as Record<string, unknown>;
      const inner = payload?.payload as Record<string, unknown> | undefined;
      if (!inner) continue;

      switch (event.name) {
        case "thread:created":
          if (inner.repoId) meta.repoId = inner.repoId;
          if (inner.worktreeId) meta.worktreeId = inner.worktreeId;
          break;
        case "thread:name:generated":
          if (inner.name) meta.name = inner.name;
          break;
        case "thread:status:changed":
          if (inner.status) meta.status = inner.status;
          break;
      }
    }

    return meta;
  }

  /** Seed VirtualFS so threadService reads succeed */
  private seedVirtualDisk(): void {
    const dir = `${MOCK_MORT_DIR}/threads/${this.threadId}`;
    VirtualFS.seed({
      [`${dir}/metadata.json`]: this.diskMetadata,
      [`${dir}/state.json`]: this.diskState,
    });
  }

  /**
   * Replay all captured events through routeAgentMessage().
   * Each event flows through the real production pipeline.
   *
   * Sets activeThreadId so AGENT_COMPLETED triggers loadThreadState.
   */
  async replay(): Promise<void> {
    // Set active thread so completion listener loads state
    useThreadStore.getState().setActiveThread(this.threadId);

    for (const event of this.events) {
      routeAgentMessage(event.payload as Parameters<typeof routeAgentMessage>[0]);
      // Events that trigger async listeners (refreshById, etc.) need deeper flushing
      if (event.type === "event") {
        await flushAsyncListeners();
      } else {
        await waitForReact();
      }
    }
  }

  /**
   * Replay up to a specific event index (for intermediate snapshots).
   */
  async replayUntil(stopIndex: number): Promise<void> {
    useThreadStore.getState().setActiveThread(this.threadId);

    const limit = Math.min(stopIndex, this.events.length);
    for (let i = 0; i < limit; i++) {
      routeAgentMessage(this.events[i].payload as Parameters<typeof routeAgentMessage>[0]);
      await waitForReact();
    }
  }

  /**
   * Synthesize AGENT_COMPLETED to trigger final state hydration.
   *
   * In production this is a Tauri process lifecycle event, not a socket
   * message — so it's never in the captured JSON. But it triggers the
   * critical loadThreadState() that reads state.json from disk.
   */
  async complete(): Promise<void> {
    // Emit AGENT_COMPLETED for listeners that react synchronously
    // (heartbeat cleanup, chain state clear, etc.)
    eventBus.emit(EventName.AGENT_COMPLETED, {
      threadId: this.threadId,
      exitCode: 0,
    });
    await flushAsyncListeners();

    // In production, the async AGENT_COMPLETED listener calls refreshById +
    // loadThreadState. Since mitt async listeners are fire-and-forget and
    // unreliable in test environments, we call these directly to guarantee
    // the same side effects (metadata + state hydration from disk).
    await threadService.refreshById(this.threadId);
    await threadService.loadThreadState(this.threadId);
  }

  /** Replay all events + synthesize completion */
  async replayToCompletion(): Promise<void> {
    await this.replay();
    await this.complete();
  }

  get id(): string {
    return this.threadId;
  }

  get state(): ThreadState {
    return this.diskState;
  }

  get eventCount(): number {
    return this.events.length;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Keep only hub:emitted events (deduplicate hub:received duplicates) */
function deduplicateEvents(events: CapturedEvent[]): CapturedEvent[] {
  const seqMap = new Map<number, CapturedEvent>();
  for (const event of events) {
    const seq = event.pipeline?.[0]?.seq;
    if (seq == null) continue;
    const hasEmitted = event.pipeline?.some((s) => s.stage === "hub:emitted");
    if (!seqMap.has(seq) || hasEmitted) {
      seqMap.set(seq, event);
    }
  }
  return [...seqMap.values()].sort((a, b) => a.id - b.id);
}
