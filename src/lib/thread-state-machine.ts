import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer.js";
import type { ThreadState } from "@core/types/events.js";

// ============================================================================
// Transport Events — what the machine receives from the socket layer
// ============================================================================

export type TransportEvent =
  | { type: "THREAD_ACTION"; action: ThreadAction }
  | { type: "HYDRATE"; state: ThreadState };

// ============================================================================
// ThreadRenderState — projection of ThreadState for UI consumption
// ============================================================================

export type ThreadRenderState = ThreadState;

// ============================================================================
// ThreadStateMachine
// ============================================================================

/**
 * Client-side state machine that applies ThreadActions through the shared
 * reducer. Streaming is now handled by the reducer itself (STREAM_START /
 * STREAM_DELTA actions) so the machine is a thin wrapper.
 *
 * - THREAD_ACTION: applied through shared reducer
 * - HYDRATE: full state replacement from disk (cold start / reconnect)
 */
export class ThreadStateMachine {
  private state: ThreadState;

  constructor(initial?: ThreadState) {
    this.state = initial ?? {
      messages: [],
      fileChanges: [],
      workingDirectory: "",
      status: "running",
      timestamp: 0,
      toolStates: {},
    };
  }

  getState(): ThreadRenderState {
    return this.state;
  }

  apply(event: TransportEvent): ThreadRenderState {
    switch (event.type) {
      case "THREAD_ACTION":
        this.state = threadReducer(this.state, event.action);
        return this.state;
      case "HYDRATE":
        this.state = { ...event.state };
        return this.state;
    }
  }
}
