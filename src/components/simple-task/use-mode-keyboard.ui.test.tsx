/**
 * useModeKeyboard Hook UI Tests
 *
 * Validates keyboard handling for mode cycling with Shift+Tab.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { useAgentModeStore } from "@/entities/agent-mode";
import { useModeKeyboard } from "./use-mode-keyboard";
import type { AgentMode } from "@/entities/agent-mode";

/**
 * Test component that uses the hook and exposes keyboard handling.
 */
function TestComponent({
  threadId,
  onModeChange,
  enabled = true,
}: {
  threadId: string;
  onModeChange?: (mode: AgentMode) => void;
  enabled?: boolean;
}) {
  const { handleKeyDown, currentMode } = useModeKeyboard({
    threadId,
    onModeChange,
    enabled,
  });

  return (
    <div>
      <input
        data-testid="input"
        onKeyDown={handleKeyDown}
        aria-label="test input"
      />
      <span data-testid="current-mode">{currentMode}</span>
    </div>
  );
}

describe("useModeKeyboard", () => {
  const threadId = "test-thread-123";

  beforeEach(() => {
    // Reset store state before each test
    useAgentModeStore.setState({
      threadModes: {},
      defaultMode: "normal",
    });
  });

  describe("mode cycling", () => {
    it("cycles mode from normal to plan on Shift+Tab", () => {
      const onModeChange = vi.fn();
      render(<TestComponent threadId={threadId} onModeChange={onModeChange} />);

      const input = screen.getByTestId("input");
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });

      expect(onModeChange).toHaveBeenCalledWith("plan");
      expect(screen.getByTestId("current-mode")).toHaveTextContent("plan");
    });

    it("cycles mode from plan to auto-accept", () => {
      useAgentModeStore.getState().setMode(threadId, "plan");
      const onModeChange = vi.fn();
      render(<TestComponent threadId={threadId} onModeChange={onModeChange} />);

      const input = screen.getByTestId("input");
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });

      expect(onModeChange).toHaveBeenCalledWith("auto-accept");
    });

    it("cycles mode from auto-accept back to normal", () => {
      useAgentModeStore.getState().setMode(threadId, "auto-accept");
      const onModeChange = vi.fn();
      render(<TestComponent threadId={threadId} onModeChange={onModeChange} />);

      const input = screen.getByTestId("input");
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });

      expect(onModeChange).toHaveBeenCalledWith("normal");
    });

    it("prevents default on Shift+Tab", () => {
      render(<TestComponent threadId={threadId} />);

      const input = screen.getByTestId("input");
      const event = fireEvent.keyDown(input, { key: "Tab", shiftKey: true });

      // fireEvent returns false when preventDefault was called
      expect(event).toBe(false);
    });
  });

  describe("non-cycling keys", () => {
    it("does not cycle on Tab without Shift", () => {
      const onModeChange = vi.fn();
      render(<TestComponent threadId={threadId} onModeChange={onModeChange} />);

      const input = screen.getByTestId("input");
      fireEvent.keyDown(input, { key: "Tab", shiftKey: false });

      expect(onModeChange).not.toHaveBeenCalled();
      expect(screen.getByTestId("current-mode")).toHaveTextContent("normal");
    });

    it("does not cycle on other key combinations", () => {
      const onModeChange = vi.fn();
      render(<TestComponent threadId={threadId} onModeChange={onModeChange} />);

      const input = screen.getByTestId("input");

      // Try various key combinations
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
      fireEvent.keyDown(input, { key: "Space", shiftKey: true });
      fireEvent.keyDown(input, { key: "a", shiftKey: true });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(onModeChange).not.toHaveBeenCalled();
    });
  });

  describe("enabled state", () => {
    it("does not cycle when disabled", () => {
      const onModeChange = vi.fn();
      render(
        <TestComponent
          threadId={threadId}
          onModeChange={onModeChange}
          enabled={false}
        />
      );

      const input = screen.getByTestId("input");
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });

      expect(onModeChange).not.toHaveBeenCalled();
      expect(screen.getByTestId("current-mode")).toHaveTextContent("normal");
    });
  });

  describe("per-thread isolation", () => {
    it("maintains separate modes per thread", () => {
      // Set different modes for different threads
      useAgentModeStore.getState().setMode("thread-a", "plan");
      useAgentModeStore.getState().setMode("thread-b", "auto-accept");

      const { rerender } = render(<TestComponent threadId="thread-a" />);
      expect(screen.getByTestId("current-mode")).toHaveTextContent("plan");

      rerender(<TestComponent threadId="thread-b" />);
      expect(screen.getByTestId("current-mode")).toHaveTextContent("auto-accept");
    });

    it("uses default mode for threads without explicit mode", () => {
      useAgentModeStore.getState().setDefaultMode("plan");

      render(<TestComponent threadId="new-thread" />);

      expect(screen.getByTestId("current-mode")).toHaveTextContent("plan");
    });

    it("cycles independently per thread", () => {
      const onModeChange = vi.fn();

      // Start thread-a at normal, thread-b at plan
      useAgentModeStore.getState().setMode("thread-b", "plan");

      // Cycle thread-a
      const { rerender } = render(
        <TestComponent threadId="thread-a" onModeChange={onModeChange} />
      );
      fireEvent.keyDown(screen.getByTestId("input"), {
        key: "Tab",
        shiftKey: true,
      });
      expect(onModeChange).toHaveBeenLastCalledWith("plan");

      // Verify thread-b is still at plan (unchanged)
      rerender(<TestComponent threadId="thread-b" onModeChange={onModeChange} />);
      expect(screen.getByTestId("current-mode")).toHaveTextContent("plan");
    });
  });

  describe("callback behavior", () => {
    it("works without onModeChange callback", () => {
      render(<TestComponent threadId={threadId} />);

      const input = screen.getByTestId("input");
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });

      // Should cycle without error
      expect(screen.getByTestId("current-mode")).toHaveTextContent("plan");
    });
  });

  describe("edge cases", () => {
    describe("rapid repeated Shift+Tab", () => {
      it("handles rapid repeated key presses", () => {
        const onModeChange = vi.fn();
        render(
          <TestComponent threadId={threadId} onModeChange={onModeChange} />
        );

        const input = screen.getByTestId("input");

        // Rapidly press Shift+Tab 10 times
        for (let i = 0; i < 10; i++) {
          fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
        }

        // Should have called onModeChange 10 times (cycling through modes)
        expect(onModeChange).toHaveBeenCalledTimes(10);
        // 10 cycles from normal: 10 % 3 = 1, so should be at plan
        expect(screen.getByTestId("current-mode")).toHaveTextContent("plan");
      });

      it("handles full cycle back to starting mode", () => {
        render(<TestComponent threadId={threadId} />);

        const input = screen.getByTestId("input");

        // Press 3 times to complete a full cycle
        fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
        expect(screen.getByTestId("current-mode")).toHaveTextContent("plan");

        fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
        expect(screen.getByTestId("current-mode")).toHaveTextContent(
          "auto-accept"
        );

        fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
        expect(screen.getByTestId("current-mode")).toHaveTextContent("normal");
      });
    });

    describe("modifier key combinations", () => {
      it("does not cycle on Shift+Tab with Ctrl", () => {
        const onModeChange = vi.fn();
        render(
          <TestComponent threadId={threadId} onModeChange={onModeChange} />
        );

        const input = screen.getByTestId("input");
        fireEvent.keyDown(input, { key: "Tab", shiftKey: true, ctrlKey: true });

        expect(onModeChange).not.toHaveBeenCalled();
      });

      it("does not cycle on Shift+Tab with Alt", () => {
        const onModeChange = vi.fn();
        render(
          <TestComponent threadId={threadId} onModeChange={onModeChange} />
        );

        const input = screen.getByTestId("input");
        fireEvent.keyDown(input, { key: "Tab", shiftKey: true, altKey: true });

        expect(onModeChange).not.toHaveBeenCalled();
      });

      it("does not cycle on Shift+Tab with Meta", () => {
        const onModeChange = vi.fn();
        render(
          <TestComponent threadId={threadId} onModeChange={onModeChange} />
        );

        const input = screen.getByTestId("input");
        fireEvent.keyDown(input, { key: "Tab", shiftKey: true, metaKey: true });

        expect(onModeChange).not.toHaveBeenCalled();
      });
    });
  });
});
