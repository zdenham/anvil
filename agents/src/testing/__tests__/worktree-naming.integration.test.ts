import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateWorktreeName } from "../../services/worktree-naming-service.js";

// Mock the AI SDK
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}));

describe("worktree-naming-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateWorktreeName", () => {
    it("returns sanitized prompt for short inputs", async () => {
      const name = await generateWorktreeName("fix bug", "test-key");
      expect(name).toBe("fix-bug");
      expect(name.length).toBeLessThanOrEqual(10);
    });

    it("sanitizes special characters", async () => {
      const name = await generateWorktreeName("Fix Bug!", "test-key");
      expect(name).toBe("fix-bug");
    });

    it("truncates long sanitized names to 10 chars", async () => {
      const { generateText } = await import("ai");
      // Mock LLM to return a name longer than 10 chars
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "abcdefghijklmnop",
      });

      // Input > 10 chars triggers LLM path
      const name = await generateWorktreeName("abcdefghijk", "test-key");
      expect(name.length).toBeLessThanOrEqual(10);
    });

    it("calls LLM for long prompts", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "auth-fix",
      });

      const name = await generateWorktreeName(
        "Implement user authentication with OAuth2 and JWT tokens",
        "test-key"
      );

      expect(generateText).toHaveBeenCalled();
      expect(name).toBe("auth-fix");
    });

    it("produces valid worktree names", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "Test Name With Spaces!",
      });

      const name = await generateWorktreeName(
        "A very long prompt that needs LLM processing",
        "test-key"
      );

      // Should be sanitized
      expect(name).toMatch(/^[a-z0-9-]+$/);
      expect(name.length).toBeLessThanOrEqual(10);
    });
  });
});
