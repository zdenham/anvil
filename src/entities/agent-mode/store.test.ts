import { describe, it, expect, beforeEach } from "vitest";
import { useAgentModeStore } from "./store.js";

describe("Agent Mode Store", () => {
  beforeEach(() => {
    // Reset store to default state before each test
    useAgentModeStore.setState({
      threadModes: {},
      defaultMode: "normal",
    });
  });

  describe("getMode", () => {
    it("returns default mode when thread has no mode set", () => {
      const mode = useAgentModeStore.getState().getMode("thread-1");
      expect(mode).toBe("normal");
    });

    it("returns thread-specific mode when set", () => {
      useAgentModeStore.setState({
        threadModes: { "thread-1": "plan" },
      });

      const mode = useAgentModeStore.getState().getMode("thread-1");
      expect(mode).toBe("plan");
    });

    it("returns default mode for thread without mode, even when other threads have modes", () => {
      useAgentModeStore.setState({
        threadModes: { "thread-1": "plan" },
      });

      const mode = useAgentModeStore.getState().getMode("thread-2");
      expect(mode).toBe("normal");
    });

    it("respects custom default mode", () => {
      useAgentModeStore.setState({ defaultMode: "auto-accept" });

      const mode = useAgentModeStore.getState().getMode("new-thread");
      expect(mode).toBe("auto-accept");
    });
  });

  describe("setMode", () => {
    it("sets mode for a specific thread", () => {
      useAgentModeStore.getState().setMode("thread-1", "plan");

      expect(useAgentModeStore.getState().threadModes["thread-1"]).toBe("plan");
    });

    it("overwrites existing mode for a thread", () => {
      useAgentModeStore.getState().setMode("thread-1", "plan");
      useAgentModeStore.getState().setMode("thread-1", "auto-accept");

      expect(useAgentModeStore.getState().threadModes["thread-1"]).toBe(
        "auto-accept"
      );
    });

    it("does not affect other threads", () => {
      useAgentModeStore.getState().setMode("thread-1", "plan");
      useAgentModeStore.getState().setMode("thread-2", "auto-accept");

      expect(useAgentModeStore.getState().threadModes["thread-1"]).toBe("plan");
      expect(useAgentModeStore.getState().threadModes["thread-2"]).toBe(
        "auto-accept"
      );
    });
  });

  describe("cycleMode", () => {
    it("cycles through all modes starting from default", () => {
      const threadId = "thread-1";

      // Default is normal, should cycle to plan
      const mode1 = useAgentModeStore.getState().cycleMode(threadId);
      expect(mode1).toBe("plan");
      expect(useAgentModeStore.getState().getMode(threadId)).toBe("plan");

      // Plan should cycle to auto-accept
      const mode2 = useAgentModeStore.getState().cycleMode(threadId);
      expect(mode2).toBe("auto-accept");
      expect(useAgentModeStore.getState().getMode(threadId)).toBe("auto-accept");

      // Auto-accept should cycle back to normal
      const mode3 = useAgentModeStore.getState().cycleMode(threadId);
      expect(mode3).toBe("normal");
      expect(useAgentModeStore.getState().getMode(threadId)).toBe("normal");
    });

    it("returns the new mode", () => {
      const newMode = useAgentModeStore.getState().cycleMode("thread-1");
      expect(newMode).toBe("plan");
    });

    it("cycles independently for different threads", () => {
      useAgentModeStore.getState().cycleMode("thread-1"); // normal -> plan
      useAgentModeStore.getState().cycleMode("thread-1"); // plan -> auto-accept

      // Thread-2 should start fresh from default
      const thread2Mode = useAgentModeStore.getState().cycleMode("thread-2");
      expect(thread2Mode).toBe("plan");

      expect(useAgentModeStore.getState().getMode("thread-1")).toBe(
        "auto-accept"
      );
      expect(useAgentModeStore.getState().getMode("thread-2")).toBe("plan");
    });
  });

  describe("setDefaultMode", () => {
    it("changes the default mode", () => {
      useAgentModeStore.getState().setDefaultMode("auto-accept");

      expect(useAgentModeStore.getState().defaultMode).toBe("auto-accept");
    });

    it("affects getMode for threads without explicit mode", () => {
      useAgentModeStore.getState().setDefaultMode("plan");

      const mode = useAgentModeStore.getState().getMode("new-thread");
      expect(mode).toBe("plan");
    });

    it("does not affect threads with explicit mode set", () => {
      useAgentModeStore.getState().setMode("thread-1", "auto-accept");
      useAgentModeStore.getState().setDefaultMode("plan");

      expect(useAgentModeStore.getState().getMode("thread-1")).toBe(
        "auto-accept"
      );
    });
  });

  describe("clearThreadMode", () => {
    it("removes mode for a specific thread", () => {
      useAgentModeStore.getState().setMode("thread-1", "plan");
      useAgentModeStore.getState().clearThreadMode("thread-1");

      expect(useAgentModeStore.getState().threadModes["thread-1"]).toBeUndefined();
    });

    it("thread falls back to default mode after clearing", () => {
      useAgentModeStore.getState().setMode("thread-1", "auto-accept");
      useAgentModeStore.getState().clearThreadMode("thread-1");

      const mode = useAgentModeStore.getState().getMode("thread-1");
      expect(mode).toBe("normal");
    });

    it("does not affect other threads", () => {
      useAgentModeStore.getState().setMode("thread-1", "plan");
      useAgentModeStore.getState().setMode("thread-2", "auto-accept");
      useAgentModeStore.getState().clearThreadMode("thread-1");

      expect(useAgentModeStore.getState().getMode("thread-2")).toBe(
        "auto-accept"
      );
    });

    it("is a no-op for threads without mode", () => {
      const originalState = { ...useAgentModeStore.getState().threadModes };
      useAgentModeStore.getState().clearThreadMode("non-existent-thread");

      expect(useAgentModeStore.getState().threadModes).toEqual(originalState);
    });
  });

  describe("edge cases", () => {
    describe("thread ID with special characters", () => {
      it("handles thread ID with spaces", () => {
        useAgentModeStore.getState().setMode("thread with spaces", "plan");
        expect(useAgentModeStore.getState().getMode("thread with spaces")).toBe(
          "plan"
        );
      });

      it("handles thread ID with unicode characters", () => {
        useAgentModeStore.getState().setMode("thread-🚀-emoji", "auto-accept");
        expect(useAgentModeStore.getState().getMode("thread-🚀-emoji")).toBe(
          "auto-accept"
        );
      });

      it("handles thread ID with slashes and dots", () => {
        useAgentModeStore.getState().setMode("path/to/thread.id", "plan");
        expect(useAgentModeStore.getState().getMode("path/to/thread.id")).toBe(
          "plan"
        );
      });

      it("handles very long thread ID", () => {
        const longId = "a".repeat(1000);
        useAgentModeStore.getState().setMode(longId, "plan");
        expect(useAgentModeStore.getState().getMode(longId)).toBe("plan");
      });
    });

    describe("clearThreadMode multiple times", () => {
      it("clearing same thread multiple times is safe", () => {
        useAgentModeStore.getState().setMode("thread-1", "plan");
        useAgentModeStore.getState().clearThreadMode("thread-1");
        useAgentModeStore.getState().clearThreadMode("thread-1");
        useAgentModeStore.getState().clearThreadMode("thread-1");

        expect(useAgentModeStore.getState().getMode("thread-1")).toBe("normal");
      });
    });

    describe("cycleMode after setDefaultMode", () => {
      it("cycles from new default mode immediately", () => {
        useAgentModeStore.getState().setDefaultMode("plan");
        // New thread should start at plan and cycle to auto-accept
        const newMode = useAgentModeStore.getState().cycleMode("new-thread");
        expect(newMode).toBe("auto-accept");
      });

      it("existing thread modes unaffected by default change", () => {
        useAgentModeStore.getState().setMode("existing", "normal");
        useAgentModeStore.getState().setDefaultMode("auto-accept");
        // Existing thread should still be at normal and cycle to plan
        const newMode = useAgentModeStore.getState().cycleMode("existing");
        expect(newMode).toBe("plan");
      });
    });

    describe("empty string threadId", () => {
      it("handles empty string as thread ID", () => {
        useAgentModeStore.getState().setMode("", "plan");
        expect(useAgentModeStore.getState().getMode("")).toBe("plan");
      });

      it("can cycle mode for empty string thread ID", () => {
        const newMode = useAgentModeStore.getState().cycleMode("");
        expect(newMode).toBe("plan");
      });

      it("can clear mode for empty string thread ID", () => {
        useAgentModeStore.getState().setMode("", "auto-accept");
        useAgentModeStore.getState().clearThreadMode("");
        expect(useAgentModeStore.getState().getMode("")).toBe("normal");
      });
    });
  });
});
