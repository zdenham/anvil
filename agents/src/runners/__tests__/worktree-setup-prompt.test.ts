import { describe, it, expect } from "vitest";
import { RepositorySettingsSchema } from "@core/types/repositories.js";

describe("RepositorySettingsSchema — worktreeSetupPrompt", () => {
  // Minimal valid settings object for testing
  const baseSettings = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    schemaVersion: 1 as const,
    name: "test-repo",
    originalUrl: null,
    sourcePath: "/tmp/test-repo",
    useWorktrees: true,
    defaultBranch: "main",
    createdAt: Date.now(),
    worktrees: [],
    threadBranches: {},
    lastUpdated: Date.now(),
    plansDirectory: "plans/",
    completedDirectory: "plans/completed/",
  };

  it("defaults to null when worktreeSetupPrompt is missing", () => {
    const result = RepositorySettingsSchema.parse(baseSettings);
    expect(result.worktreeSetupPrompt).toBeNull();
  });

  it("accepts null for worktreeSetupPrompt", () => {
    const result = RepositorySettingsSchema.parse({
      ...baseSettings,
      worktreeSetupPrompt: null,
    });
    expect(result.worktreeSetupPrompt).toBeNull();
  });

  it("accepts a string for worktreeSetupPrompt", () => {
    const prompt = "Copy .env from main worktree, run npm install";
    const result = RepositorySettingsSchema.parse({
      ...baseSettings,
      worktreeSetupPrompt: prompt,
    });
    expect(result.worktreeSetupPrompt).toBe(prompt);
  });

  it("rejects non-string, non-null values for worktreeSetupPrompt", () => {
    expect(() =>
      RepositorySettingsSchema.parse({
        ...baseSettings,
        worktreeSetupPrompt: 42,
      })
    ).toThrow();
  });
});
