const DEFAULT_WS_PORT = 9600;

/**
 * Get the agent hub WebSocket endpoint URL.
 *
 * Checks in this order:
 * 1. MORT_AGENT_HUB_WS_URL env var → custom WebSocket URL
 * 2. Default: ws://127.0.0.1:{MORT_WS_PORT || 9600}/ws/agent
 */
export function getHubEndpoint(): string {
  if (process.env.MORT_AGENT_HUB_WS_URL) {
    return process.env.MORT_AGENT_HUB_WS_URL;
  }
  const port = process.env.MORT_WS_PORT ?? DEFAULT_WS_PORT;
  return `ws://127.0.0.1:${port}/ws/agent`;
}
