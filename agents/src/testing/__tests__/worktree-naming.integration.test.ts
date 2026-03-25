import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateWorktreeName } from "../../services/worktree-naming-service.js";

// Mock the LLM fallback layer (the boundary between naming logic and the Anthropic SDK)
vi.mock("@core/lib/naming/llm-fallback.js", () => ({
  generateWithFallback: vi.fn(),
}));

describe("worktree-naming-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateWorktreeName", () => {
    it("returns sanitized prompt for short inputs", async () => {
      const result = await generateWorktreeName("fix bug");
      expect(result.name).toBe("fix-bug");
      expect(result.name.length).toBeLessThanOrEqual(10);
    });

    it("sanitizes special characters", async () => {
      const result = await generateWorktreeName("Fix Bug!");
      expect(result.name).toBe("fix-bug");
    });

    it("calls LLM for long prompts", async () => {
      const { generateWithFallback } = await import("@core/lib/naming/llm-fallback.js");
      (generateWithFallback as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "auth-fix",
        usedFallback: false,
      });

      const result = await generateWorktreeName(
        "Implement user authentication with OAuth2 and JWT tokens",
      );

      expect(generateWithFallback).toHaveBeenCalled();
      expect(result.name).toBe("auth-fix");
    });

    it("produces valid worktree names", async () => {
      const { generateWithFallback } = await import("@core/lib/naming/llm-fallback.js");
      (generateWithFallback as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "Test Name With Spaces!",
        usedFallback: false,
      });

      const result = await generateWorktreeName(
        "A very long prompt that needs LLM processing",
      );

      // Should be sanitized
      expect(result.name).toMatch(/^[a-z0-9-]+$/);
    });
  });
});
