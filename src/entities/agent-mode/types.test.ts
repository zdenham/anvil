import { describe, it, expect } from "vitest";
import { getNextMode, AGENT_MODE_ORDER, AGENT_MODE_CONFIG } from "./types.js";
import type { AgentMode } from "./types.js";

describe("AGENT_MODE_ORDER", () => {
  it("has expected sequence of modes", () => {
    expect(AGENT_MODE_ORDER).toEqual(["normal", "plan", "auto-accept"]);
  });

  it("has exactly 3 modes", () => {
    expect(AGENT_MODE_ORDER).toHaveLength(3);
  });
});

describe("AGENT_MODE_CONFIG", () => {
  it("has configuration for all modes in AGENT_MODE_ORDER", () => {
    for (const mode of AGENT_MODE_ORDER) {
      expect(AGENT_MODE_CONFIG[mode]).toBeDefined();
      expect(AGENT_MODE_CONFIG[mode].label).toBeTruthy();
      expect(AGENT_MODE_CONFIG[mode].shortLabel).toBeTruthy();
      expect(AGENT_MODE_CONFIG[mode].description).toBeTruthy();
      expect(AGENT_MODE_CONFIG[mode].className).toBeTruthy();
    }
  });
});

describe("getNextMode", () => {
  it("cycles normal -> plan", () => {
    expect(getNextMode("normal")).toBe("plan");
  });

  it("cycles plan -> auto-accept", () => {
    expect(getNextMode("plan")).toBe("auto-accept");
  });

  it("cycles auto-accept -> normal (wraps around)", () => {
    expect(getNextMode("auto-accept")).toBe("normal");
  });

  it("cycles through all modes in order", () => {
    let current: AgentMode = "normal";
    const visited: AgentMode[] = [current];

    for (let i = 0; i < AGENT_MODE_ORDER.length; i++) {
      current = getNextMode(current);
      visited.push(current);
    }

    // Should cycle back to start
    expect(visited[0]).toBe(visited[visited.length - 1]);
    // Should have visited all modes
    expect(new Set(visited).size).toBe(AGENT_MODE_ORDER.length);
  });
});
