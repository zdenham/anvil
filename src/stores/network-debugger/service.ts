import { useNetworkDebuggerStore } from "./store";

// ============================================================================
// Network Message Dispatcher
// ============================================================================

/**
 * Routes incoming network hub messages to the appropriate store handler.
 *
 * Hub messages arrive with `type: "network"` and `networkType` carrying
 * the event discriminator (e.g. "request-start", "response-headers").
 */
export function handleNetworkMessage(msg: Record<string, unknown>): void {
  const store = useNetworkDebuggerStore.getState();
  const networkType = msg.networkType as string;

  switch (networkType) {
    case "request-start":
      store.handleRequestStart(msg);
      break;
    case "response-headers":
      store.handleResponseHeaders(msg);
      break;
    case "response-chunk":
      store.handleResponseChunk(msg);
      break;
    case "response-end":
      store.handleResponseEnd(msg);
      break;
    case "request-error":
      store.handleRequestError(msg);
      break;
    default:
      // Unknown network event type — silently ignore
      break;
  }
}
