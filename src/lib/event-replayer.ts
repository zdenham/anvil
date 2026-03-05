import { routeAgentMessage } from "./agent-service";
import type { CapturedEvent } from "@/stores/event-debugger-store";

/** Event types that are safe to replay */
const REPLAYABLE_TYPES = new Set(["thread_action", "stream_delta"]);

/**
 * Replays a single captured event by routing it through the same
 * message handling as live events — bypassing Tauri transport.
 *
 * Returns true if the event was dispatched, false if skipped (unsafe type).
 */
export function replayEvent(captured: CapturedEvent): boolean {
  if (!REPLAYABLE_TYPES.has(captured.type)) {
    return false;
  }

  // The payload is the original AgentSocketMessage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routeAgentMessage(captured.payload as any);
  return true;
}
