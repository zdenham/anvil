/**
 * WebSocket connection handler.
 *
 * Manages individual WS connections: parses incoming messages, dispatches
 * commands, sends responses, and forwards push events.
 */

import type { WebSocket } from "ws";
import type { SidecarState } from "./state.js";
import type { WsResponse } from "./types.js";
import { isRelayMessage, isRequest } from "./types.js";
import { dispatch } from "./dispatch.js";

export function handleConnection(
  socket: WebSocket,
  state: SidecarState,
): void {
  // Subscribe to push events and forward to this client
  const unsubscribe = state.broadcaster.subscribe((event) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  });

  socket.on("message", (data) => {
    handleMessage(socket, state, data).catch((err) => {
      console.error("[ws-handler] Unhandled error:", err);
    });
  });

  socket.on("close", () => {
    unsubscribe();
  });

  socket.on("error", () => {
    unsubscribe();
  });
}

async function handleMessage(
  socket: WebSocket,
  state: SidecarState,
  data: unknown,
): Promise<void> {
  let msg: unknown;
  try {
    msg = JSON.parse(String(data));
  } catch {
    return;
  }

  // Relay messages: broadcast to all other clients
  if (isRelayMessage(msg)) {
    state.broadcaster.broadcast(msg.event, msg.payload);
    return;
  }

  // Command request: dispatch and respond
  if (isRequest(msg)) {
    const { id, cmd, args } = msg;
    let response: WsResponse;
    try {
      const result = await dispatch(cmd, args ?? {}, state);
      response = { id, result: result ?? null };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      response = { id, error: message };
    }
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(response));
    }
  }
}
