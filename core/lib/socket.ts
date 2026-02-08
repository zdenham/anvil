import { join } from "path";
import { getMortDir } from "./mort-dir.js";

/**
 * Get the path to the agent hub socket.
 *
 * Checks for socket path in this order:
 * 1. MORT_HUB_SOCKET_PATH env var (for tests with isolated mock hubs)
 * 2. Default: {mortDir}/agent-hub.sock (production)
 */
export function getHubSocketPath(): string {
  // Allow tests to override socket path for isolated mock hubs
  if (process.env.MORT_HUB_SOCKET_PATH) {
    return process.env.MORT_HUB_SOCKET_PATH;
  }
  return join(getMortDir(), "agent-hub.sock");
}
