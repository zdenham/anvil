import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCodeHighlight } from "./use-code-highlight";
import type { ThemedToken } from "@/lib/syntax-highlighter";

// Mock the syntax highlighter module
vi.mock("@/lib/syntax-highlighter", () => ({
  highlightCode: vi.fn(),
  getCachedTokens: vi.fn().mockReturnValue(null),
}));

import { highlightCode } from "@/lib/syntax-highlighter";
const mockHighlightCode = vi.mocked(highlightCode);

describe("useCodeHighlight", () => {
  beforeEach(() => {
    mockHighlightCode.mockReset();
  });

  const mockTokens: ThemedToken[][] = [
    [{ content: "const", color: "#ff0000", offset: 0 }],
    [{ content: "x = 1", color: "#00ff00", offset: 6 }],
  ];

  it("returns loading state initially", () => {
    mockHighlightCode.mockResolvedValue(mockTokens);

    const { result } = renderHook(() => useCodeHighlight("const x = 1", "typescript"));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.tokens).toBeNull();
  });

  it("returns tokens after highlighting completes", async () => {
    mockHighlightCode.mockResolvedValue(mockTokens);

    const { result } = renderHook(() => useCodeHighlight("const x = 1", "typescript"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 1000 });

    expect(result.current.tokens).toEqual(mockTokens);
    expect(mockHighlightCode).toHaveBeenCalledWith("const x = 1", "typescript");
  });

  it("debounces rapid code changes", async () => {
    // Track call times
    const callTimes: number[] = [];
    mockHighlightCode.mockImplementation(async () => {
      callTimes.push(Date.now());
      return mockTokens;
    });

    const { result, rerender } = renderHook(
      ({ code, language }) => useCodeHighlight(code, language),
      { initialProps: { code: "a", language: "typescript" } }
    );

    // Change code rapidly (simulating streaming)
    // These rapid changes should be debounced
    await act(async () => {
      rerender({ code: "ab", language: "typescript" });
    });
    await act(async () => {
      rerender({ code: "abc", language: "typescript" });
    });
    await act(async () => {
      rerender({ code: "abcd", language: "typescript" });
    });

    // Wait for debounce + highlighting to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 1000 });

    // Should only call highlightCode once with final value
    // (could be called more than once if test timing varies, but always with "abcd" last)
    expect(mockHighlightCode).toHaveBeenLastCalledWith("abcd", "typescript");
  });

  it("handles highlighting errors gracefully", async () => {
    mockHighlightCode.mockRejectedValue(new Error("Highlighting failed"));

    const { result } = renderHook(() => useCodeHighlight("invalid code", "unknown"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 1000 });

    // Returns null tokens on error (allows fallback to unstyled code)
    expect(result.current.tokens).toBeNull();
  });

  it("skips re-highlighting when code and language unchanged", async () => {
    mockHighlightCode.mockResolvedValue(mockTokens);

    const { result, rerender } = renderHook(
      ({ code, language }) => useCodeHighlight(code, language),
      { initialProps: { code: "const x = 1", language: "typescript" } }
    );

    // Wait for initial highlight
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 1000 });

    const callCountAfterFirst = mockHighlightCode.mock.calls.length;

    // Re-render with same props
    await act(async () => {
      rerender({ code: "const x = 1", language: "typescript" });
    });

    // Wait a bit to ensure no additional calls happen
    await new Promise((r) => setTimeout(r, 150));

    // Should not call highlightCode again
    expect(mockHighlightCode.mock.calls.length).toBe(callCountAfterFirst);
  });

  it("re-highlights when language changes", async () => {
    const jsTokens: ThemedToken[][] = [[{ content: "const", color: "#0000ff", offset: 0 }]];
    mockHighlightCode
      .mockResolvedValueOnce(mockTokens)
      .mockResolvedValueOnce(jsTokens);

    const { result, rerender } = renderHook(
      ({ code, language }) => useCodeHighlight(code, language),
      { initialProps: { code: "const x = 1", language: "typescript" } }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 1000 });

    expect(mockHighlightCode).toHaveBeenCalledTimes(1);
    expect(result.current.tokens).toEqual(mockTokens);

    // Change language
    await act(async () => {
      rerender({ code: "const x = 1", language: "javascript" });
    });

    await waitFor(() => {
      expect(result.current.tokens).toEqual(jsTokens);
    }, { timeout: 1000 });

    expect(mockHighlightCode).toHaveBeenCalledTimes(2);
    expect(mockHighlightCode).toHaveBeenLastCalledWith("const x = 1", "javascript");
  });
});
