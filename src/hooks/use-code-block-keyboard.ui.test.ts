import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCodeBlockKeyboard } from "./use-code-block-keyboard";

describe("useCodeBlockKeyboard", () => {
  let container: HTMLDivElement;
  let containerRef: React.RefObject<HTMLDivElement>;

  function createCodeBlock(id: string): HTMLDivElement {
    const block = document.createElement("div");
    block.setAttribute("data-code-block", "true");
    block.setAttribute("tabindex", "0");
    block.id = id;

    // Add copy button
    const copyButton = document.createElement("button");
    copyButton.setAttribute("aria-label", "Copy code to clipboard");
    block.appendChild(copyButton);

    // Add collapse button
    const collapseButton = document.createElement("button");
    collapseButton.setAttribute("aria-label", "Collapse code block");
    block.appendChild(collapseButton);

    return block;
  }

  function createExpandButton(): HTMLButtonElement {
    const button = document.createElement("button");
    const chevron = document.createElement("span");
    chevron.className = "lucide-chevron-down";
    button.appendChild(chevron);
    return button;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    containerRef = { current: container };
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("handles Tab to move focus to next code block", () => {
    const block1 = createCodeBlock("block-1");
    const block2 = createCodeBlock("block-2");
    container.appendChild(block1);
    container.appendChild(block2);

    renderHook(() => useCodeBlockKeyboard(containerRef));

    // Focus first block
    block1.focus();
    expect(document.activeElement).toBe(block1);

    // Press Tab
    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
      });
      container.dispatchEvent(event);
    });

    expect(document.activeElement).toBe(block2);
  });

  it("handles Shift+Tab to move focus to previous code block", () => {
    const block1 = createCodeBlock("block-1");
    const block2 = createCodeBlock("block-2");
    container.appendChild(block1);
    container.appendChild(block2);

    renderHook(() => useCodeBlockKeyboard(containerRef));

    // Focus second block
    block2.focus();
    expect(document.activeElement).toBe(block2);

    // Press Shift+Tab
    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      });
      container.dispatchEvent(event);
    });

    expect(document.activeElement).toBe(block1);
  });

  it("wraps focus around when Tab at last block", () => {
    const block1 = createCodeBlock("block-1");
    const block2 = createCodeBlock("block-2");
    container.appendChild(block1);
    container.appendChild(block2);

    renderHook(() => useCodeBlockKeyboard(containerRef));

    // Focus last block
    block2.focus();
    expect(document.activeElement).toBe(block2);

    // Press Tab
    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
      });
      container.dispatchEvent(event);
    });

    // Should wrap to first block
    expect(document.activeElement).toBe(block1);
  });

  it("wraps focus around when Shift+Tab at first block", () => {
    const block1 = createCodeBlock("block-1");
    const block2 = createCodeBlock("block-2");
    container.appendChild(block1);
    container.appendChild(block2);

    renderHook(() => useCodeBlockKeyboard(containerRef));

    // Focus first block
    block1.focus();
    expect(document.activeElement).toBe(block1);

    // Press Shift+Tab
    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      });
      container.dispatchEvent(event);
    });

    // Should wrap to last block
    expect(document.activeElement).toBe(block2);
  });

  it("handles Cmd+C to trigger copy button click", () => {
    const block1 = createCodeBlock("block-1");
    container.appendChild(block1);

    const copyButton = block1.querySelector("button[aria-label*='Copy']") as HTMLButtonElement;
    const clickHandler = vi.fn();
    copyButton.addEventListener("click", clickHandler);

    renderHook(() => useCodeBlockKeyboard(containerRef));

    // Focus block
    block1.focus();

    // Press Cmd+C
    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "c",
        metaKey: true,
        bubbles: true,
      });
      container.dispatchEvent(event);
    });

    expect(clickHandler).toHaveBeenCalled();
  });

  it("handles Enter to toggle collapse", () => {
    const block1 = createCodeBlock("block-1");
    container.appendChild(block1);

    const collapseButton = block1.querySelector("button[aria-label*='Collapse']") as HTMLButtonElement;
    const clickHandler = vi.fn();
    collapseButton.addEventListener("click", clickHandler);

    renderHook(() => useCodeBlockKeyboard(containerRef));

    // Focus block
    block1.focus();

    // Press Enter
    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      });
      container.dispatchEvent(event);
    });

    expect(clickHandler).toHaveBeenCalled();
  });

  it("handles Space to toggle collapse", () => {
    const block1 = createCodeBlock("block-1");
    container.appendChild(block1);

    const collapseButton = block1.querySelector("button[aria-label*='Collapse']") as HTMLButtonElement;
    const clickHandler = vi.fn();
    collapseButton.addEventListener("click", clickHandler);

    renderHook(() => useCodeBlockKeyboard(containerRef));

    // Focus block
    block1.focus();

    // Press Space
    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
      });
      container.dispatchEvent(event);
    });

    expect(clickHandler).toHaveBeenCalled();
  });

  it("handles Enter to expand when expand button is present", () => {
    const block1 = document.createElement("div");
    block1.setAttribute("data-code-block", "true");
    block1.setAttribute("tabindex", "0");

    const expandButton = createExpandButton();
    const clickHandler = vi.fn();
    expandButton.addEventListener("click", clickHandler);
    block1.appendChild(expandButton);

    container.appendChild(block1);

    renderHook(() => useCodeBlockKeyboard(containerRef));

    // Focus block
    block1.focus();

    // Press Enter
    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      });
      container.dispatchEvent(event);
    });

    expect(clickHandler).toHaveBeenCalled();
  });

  it("does nothing when no code blocks in container", () => {
    renderHook(() => useCodeBlockKeyboard(containerRef));

    // Press Tab - should not throw
    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
      });
      container.dispatchEvent(event);
    });

    // No error means test passes
    expect(true).toBe(true);
  });

  it("does nothing for keyboard events when not focused on code block", () => {
    const block1 = createCodeBlock("block-1");
    const otherElement = document.createElement("input");
    container.appendChild(block1);
    container.appendChild(otherElement);

    const copyButton = block1.querySelector("button[aria-label*='Copy']") as HTMLButtonElement;
    const clickHandler = vi.fn();
    copyButton.addEventListener("click", clickHandler);

    renderHook(() => useCodeBlockKeyboard(containerRef));

    // Focus input instead of code block
    otherElement.focus();

    // Press Cmd+C
    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "c",
        metaKey: true,
        bubbles: true,
      });
      container.dispatchEvent(event);
    });

    // Should not trigger copy because focus is not on code block
    expect(clickHandler).not.toHaveBeenCalled();
  });
});
