import { describe, it, expect, vi, afterEach } from "vitest";
import { getHubEndpoint } from "./socket.js";

describe("getHubEndpoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default WebSocket URL with port 9600", () => {
    const result = getHubEndpoint();
    expect(result).toBe("ws://127.0.0.1:9600/ws/agent");
  });

  it("uses ANVIL_AGENT_HUB_WS_URL when set", () => {
    vi.stubEnv("ANVIL_AGENT_HUB_WS_URL", "ws://custom:1234/ws/agent");
    const result = getHubEndpoint();
    expect(result).toBe("ws://custom:1234/ws/agent");
  });

  it("uses ANVIL_WS_PORT when set", () => {
    vi.stubEnv("ANVIL_WS_PORT", "7777");
    const result = getHubEndpoint();
    expect(result).toBe("ws://127.0.0.1:7777/ws/agent");
  });

  it("prefers ANVIL_AGENT_HUB_WS_URL over ANVIL_WS_PORT", () => {
    vi.stubEnv("ANVIL_AGENT_HUB_WS_URL", "ws://override:9999/ws/agent");
    vi.stubEnv("ANVIL_WS_PORT", "7777");
    const result = getHubEndpoint();
    expect(result).toBe("ws://override:9999/ws/agent");
  });

  it("returns consistent value on repeated calls", () => {
    const result1 = getHubEndpoint();
    const result2 = getHubEndpoint();
    expect(result1).toBe(result2);
  });

  it("always returns a ws:// URL", () => {
    const result = getHubEndpoint();
    expect(result).toMatch(/^wss?:\/\//);
  });
});
