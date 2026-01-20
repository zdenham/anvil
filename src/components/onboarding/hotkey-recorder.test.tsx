import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HotkeyRecorder } from "./HotkeyRecorder";

describe("HotkeyRecorder", () => {
  const mockOnHotkeyChanged = vi.fn();
  const mockOnConfirm = vi.fn();

  beforeEach(() => {
    mockOnHotkeyChanged.mockClear();
    mockOnConfirm.mockClear();
  });

  const getContainer = () => screen.getByTestId("hotkey-recorder");

  describe("initial state", () => {
    it("displays default hotkey Command+Space", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);

      expect(screen.getByTestId("modifier-meta")).toHaveClass("bg-surface-900");
      expect(screen.getByTestId("hotkey-key")).toHaveTextContent("Space");
    });

    it("displays custom default hotkey", () => {
      render(
        <HotkeyRecorder
          onHotkeyChanged={mockOnHotkeyChanged}
          defaultHotkey="Ctrl+Alt+K"
        />
      );

      expect(screen.getByTestId("modifier-control")).toHaveClass(
        "bg-surface-900"
      );
      expect(screen.getByTestId("modifier-alt")).toHaveClass("bg-surface-900");
      expect(screen.getByTestId("hotkey-key")).toHaveTextContent("K");
    });

    it("starts in idle state", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      expect(getContainer()).toHaveAttribute("data-state", "idle");
    });

    it("auto-focuses by default", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      expect(getContainer()).toHaveFocus();
    });
  });

  describe("recording state", () => {
    it("enters recording state when modifier is pressed", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });

      expect(container).toHaveAttribute("data-state", "recording");
      expect(container).toHaveClass("border-blue-500");
    });

    it("lights up pressed modifiers during recording", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });

      expect(screen.getByTestId("modifier-meta")).toHaveClass("bg-surface-900");
    });

    it("shows ? for key during recording", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });

      expect(screen.getByTestId("hotkey-key")).toHaveTextContent("?");
    });

    it("tracks multiple modifiers during recording", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, {
        key: "Meta",
        metaKey: true,
        shiftKey: true,
      });

      expect(screen.getByTestId("modifier-meta")).toHaveClass("bg-surface-900");
      expect(screen.getByTestId("modifier-shift")).toHaveClass("bg-surface-900");
    });

    it("returns to idle when all modifiers released without setting", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });
      fireEvent.keyUp(container, { key: "Meta", metaKey: false });

      expect(container).toHaveAttribute("data-state", "idle");
      expect(screen.getByTestId("hotkey-key")).toHaveTextContent("Space");
    });

    it("does not call onHotkeyChanged when only modifiers pressed", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });
      fireEvent.keyDown(container, {
        key: "Shift",
        metaKey: true,
        shiftKey: true,
      });
      fireEvent.keyUp(container, {
        key: "Meta",
        metaKey: false,
        shiftKey: false,
      });

      expect(mockOnHotkeyChanged).not.toHaveBeenCalled();
    });
  });

  describe("setting hotkey", () => {
    it("sets hotkey when non-modifier pressed during recording", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });
      fireEvent.keyDown(container, { key: "k", code: "KeyK", metaKey: true });

      expect(mockOnHotkeyChanged).toHaveBeenCalledWith("Command+K");
    });

    it("enters locked state after setting hotkey", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });
      fireEvent.keyDown(container, { key: "k", code: "KeyK", metaKey: true });

      expect(container).toHaveAttribute("data-state", "locked");
      expect(container).toHaveClass("border-green-500");
    });

    it("displays the new hotkey after setting", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });
      fireEvent.keyDown(container, { key: "k", code: "KeyK", metaKey: true });

      expect(screen.getByTestId("hotkey-key")).toHaveTextContent("K");
      expect(screen.getByTestId("modifier-meta")).toHaveClass("bg-surface-900");
    });

    it("sets hotkey with multiple modifiers", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, {
        key: "Meta",
        metaKey: true,
        shiftKey: true,
      });
      fireEvent.keyDown(container, {
        key: "p",
        code: "KeyP",
        metaKey: true,
        shiftKey: true,
      });

      expect(mockOnHotkeyChanged).toHaveBeenCalledWith("Shift+Command+P");
    });

    it("normalizes keys to letters regardless of shift state", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, {
        key: "Meta",
        metaKey: true,
        shiftKey: true,
      });
      fireEvent.keyDown(container, {
        key: "!",
        code: "Digit1",
        metaKey: true,
        shiftKey: true,
      });

      expect(mockOnHotkeyChanged).toHaveBeenCalledWith("Shift+Command+1");
    });
  });

  describe("locked state", () => {
    it("ignores key presses while locked", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      // Set initial hotkey
      fireEvent.keyDown(container, { key: "Meta", metaKey: true });
      fireEvent.keyDown(container, { key: "k", code: "KeyK", metaKey: true });
      mockOnHotkeyChanged.mockClear();

      // Try to set another while still holding keys
      fireEvent.keyDown(container, { key: "j", code: "KeyJ", metaKey: true });

      expect(mockOnHotkeyChanged).not.toHaveBeenCalled();
      expect(screen.getByTestId("hotkey-key")).toHaveTextContent("K");
    });

    it("returns to idle only after all keys released", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });
      fireEvent.keyDown(container, { key: "k", code: "KeyK", metaKey: true });

      // Still holding Meta
      expect(container).toHaveAttribute("data-state", "locked");

      // Release Meta
      fireEvent.keyUp(container, { key: "Meta", metaKey: false });

      expect(container).toHaveAttribute("data-state", "idle");
    });

    it("can record new hotkey after returning to idle", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      // Set first hotkey
      fireEvent.keyDown(container, { key: "Meta", metaKey: true });
      fireEvent.keyDown(container, { key: "k", code: "KeyK", metaKey: true });
      fireEvent.keyUp(container, { key: "Meta", metaKey: false });
      mockOnHotkeyChanged.mockClear();

      // Set second hotkey
      fireEvent.keyDown(container, { key: "Control", ctrlKey: true });
      fireEvent.keyDown(container, { key: "j", code: "KeyJ", ctrlKey: true });

      expect(mockOnHotkeyChanged).toHaveBeenCalledWith("Ctrl+J");
    });
  });

  describe("clearing hotkey", () => {
    it("clears hotkey when Backspace pressed in idle state", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Backspace" });

      expect(mockOnHotkeyChanged).toHaveBeenCalledWith("");
      expect(screen.getByTestId("hotkey-key")).toHaveTextContent("?");
    });

    it("enters locked state after clearing", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Backspace" });

      expect(container).toHaveAttribute("data-state", "locked");
      expect(container).toHaveClass("border-green-500");
    });
  });

  describe("confirming with Enter", () => {
    it("calls onConfirm when Enter pressed in idle state", () => {
      render(
        <HotkeyRecorder
          onHotkeyChanged={mockOnHotkeyChanged}
          onConfirm={mockOnConfirm}
        />
      );
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Enter" });

      expect(mockOnConfirm).toHaveBeenCalled();
    });
  });

  describe("special keys display", () => {
    it("displays arrow keys with symbols", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });
      fireEvent.keyDown(container, {
        key: "ArrowUp",
        code: "ArrowUp",
        metaKey: true,
      });

      expect(screen.getByTestId("hotkey-key")).toHaveTextContent("↑");
    });
  });

  describe("overlay and status text", () => {
    it("shows overlay when unfocused and idle", () => {
      render(
        <HotkeyRecorder
          onHotkeyChanged={mockOnHotkeyChanged}
          autoFocus={false}
        />
      );

      expect(screen.getByTestId("hotkey-recorder-overlay")).toBeInTheDocument();
      expect(
        screen.getByText("Click to start recording")
      ).toBeInTheDocument();
    });

    it("hides overlay when focused", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);

      expect(
        screen.queryByTestId("hotkey-recorder-overlay")
      ).not.toBeInTheDocument();
    });

    it("clicking overlay focuses the recorder", () => {
      render(
        <HotkeyRecorder
          onHotkeyChanged={mockOnHotkeyChanged}
          autoFocus={false}
        />
      );

      const overlay = screen.getByTestId("hotkey-recorder-overlay");
      fireEvent.click(overlay);

      expect(getContainer()).toHaveFocus();
      expect(
        screen.queryByTestId("hotkey-recorder-overlay")
      ).not.toBeInTheDocument();
    });

    it("shows status text when focused and idle", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);

      expect(screen.getByTestId("hotkey-recorder-status")).toHaveTextContent(
        "Press modifier keys (⌘ ⌃ ⌥ ⇧) then a letter or key"
      );
    });

    it("shows recording status text during recording", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });

      expect(screen.getByTestId("hotkey-recorder-status")).toHaveTextContent(
        "Now press a key to complete the shortcut..."
      );
    });

    it("shows locked status text after setting hotkey", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);
      const container = getContainer();

      fireEvent.keyDown(container, { key: "Meta", metaKey: true });
      fireEvent.keyDown(container, { key: "k", code: "KeyK", metaKey: true });

      expect(screen.getByTestId("hotkey-recorder-status")).toHaveTextContent(
        "✓ Hotkey set! Release all keys to continue"
      );
    });

    it("uses teal border when focused and idle", () => {
      render(<HotkeyRecorder onHotkeyChanged={mockOnHotkeyChanged} />);

      expect(getContainer()).toHaveClass("border-secondary-500");
    });
  });
});
