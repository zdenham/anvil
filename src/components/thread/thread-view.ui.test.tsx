/**
 * ThreadView UI Tests
 *
 * Validates the ThreadView component's various state renderings.
 * This test validates the component handles different states correctly
 * (loading, empty, error, with messages).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, testIds } from "@/test/helpers";
import type { StoredMessage } from "@core/types/events";
import { useThreadStore } from "@/entities/threads/store";
import { ThreadView } from "./thread-view";

// Suppress logger output during tests
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("ThreadView UI", () => {
  beforeEach(() => {
    // Reset store state between tests
    useThreadStore.setState({ threads: {}, _threadsArray: [] });
  });

  describe("loading state", () => {
    it("renders loading spinner when status is loading", () => {
      render(
        <ThreadView
          threadId="test-thread"
          messages={[]}
          status="loading"
        />
      );

      expect(screen.getByTestId(testIds.loadingSpinner)).toBeInTheDocument();
      expect(screen.getByText("Loading thread...")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("renders empty state when idle with no messages", () => {
      render(
        <ThreadView
          threadId="test-thread"
          messages={[]}
          status="idle"
        />
      );

      // Empty state now renders blank (no text) to avoid jarring flash when switching threads
      expect(screen.getByTestId(testIds.emptyState)).toBeInTheDocument();
      expect(screen.getByRole("status", { name: "Loading thread content" })).toBeInTheDocument();
    });

    it("renders waiting state when running with no messages", () => {
      // Set thread metadata so useIsThreadRunning returns true
      useThreadStore.setState({
        threads: {
          "test-thread": { id: "test-thread", status: "running" } as never,
        },
      });

      render(
        <ThreadView
          threadId="test-thread"
          messages={[]}
          status="running"
        />
      );

      // Empty state now renders blank (no text) to avoid jarring flash when switching threads
      expect(screen.getByTestId(testIds.emptyState)).toBeInTheDocument();
      expect(screen.getByRole("status", { name: "Loading thread content" })).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders error state when status is error with no messages", () => {
      render(
        <ThreadView
          threadId="test-thread"
          messages={[]}
          status="error"
          error="Failed to connect to agent"
        />
      );

      expect(screen.getByTestId(testIds.errorMessage)).toBeInTheDocument();
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(screen.getByText("Failed to connect to agent")).toBeInTheDocument();
    });

    it("renders retry button when onRetry is provided", () => {
      const mockRetry = vi.fn();

      render(
        <ThreadView
          threadId="test-thread"
          messages={[]}
          status="error"
          error="Connection failed"
          onRetry={mockRetry}
        />
      );

      const retryButton = screen.getByRole("button", { name: /retry/i });
      expect(retryButton).toBeInTheDocument();

      retryButton.click();
      expect(mockRetry).toHaveBeenCalled();
    });
  });

  describe("message rendering", () => {
    const messages: StoredMessage[] = [
      { id: "msg-0", role: "user", content: "Hello, can you help me?" },
      { id: "msg-1", role: "assistant", content: "Of course! I'd be happy to help." },
    ];

    it("renders thread panel with messages", async () => {
      render(
        <ThreadView
          threadId="test-thread"
          messages={messages}
          status="running"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId(testIds.threadPanel)).toBeInTheDocument();
      });
    });

    it("renders message list container", async () => {
      render(
        <ThreadView
          threadId="test-thread"
          messages={messages}
          status="running"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId(testIds.messageList)).toBeInTheDocument();
      });
    });

    it("renders error banner during streaming error", async () => {
      render(
        <ThreadView
          threadId="test-thread"
          messages={messages}
          status="error"
          error="Stream interrupted"
        />
      );

      await waitFor(() => {
        // Should show message list (not error state) plus error banner
        expect(screen.getByTestId(testIds.threadPanel)).toBeInTheDocument();
        expect(screen.getByText("Stream interrupted")).toBeInTheDocument();
      });
    });
  });

  describe("accessibility", () => {
    it("has proper ARIA labels for loading state", () => {
      render(
        <ThreadView
          threadId="test-thread"
          messages={[]}
          status="loading"
        />
      );

      expect(screen.getByRole("status", { name: "Loading thread" })).toBeInTheDocument();
    });

    it("has proper role for error state", () => {
      render(
        <ThreadView
          threadId="test-thread"
          messages={[]}
          status="error"
        />
      );

      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("has proper main landmark for message view", async () => {
      const messages: StoredMessage[] = [
        { id: "msg-0", role: "user", content: "Test message" },
      ];

      render(
        <ThreadView
          threadId="test-thread"
          messages={messages}
          status="running"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("main", { name: /thread with ai assistant/i })).toBeInTheDocument();
      });
    });
  });
});
