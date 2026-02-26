import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock shared module for emitLog/emitEvent
vi.mock("../shared.js", () => ({
  emitEvent: vi.fn(),
  emitLog: vi.fn(),
}));

// Mock thread-naming-service
vi.mock("../../services/thread-naming-service.js", () => ({
  generateThreadName: vi.fn().mockResolvedValue("mock-name"),
}));

// Mock worktree-naming-service
vi.mock("../../services/worktree-naming-service.js", () => ({
  generateWorktreeName: vi.fn().mockResolvedValue("mock-worktree"),
}));

// Mock events module
vi.mock("../../lib/events.js", () => ({
  events: {
    threadNameGenerated: vi.fn(),
    worktreeNameGenerated: vi.fn(),
  },
}));

// Mock NodeGitAdapter
vi.mock("@core/adapters/node/git-adapter.js", () => ({
  NodeGitAdapter: vi.fn().mockImplementation(() => ({
    branchExists: vi.fn().mockReturnValue(false),
    createBranch: vi.fn(),
    checkoutBranch: vi.fn(),
  })),
}));

import { SimpleRunnerStrategy } from "../simple-runner-strategy.js";
import { emitLog } from "../shared.js";
import { generateThreadName } from "../../services/thread-naming-service.js";
import { generateWorktreeName } from "../../services/worktree-naming-service.js";

describe("SimpleRunnerStrategy --skip-naming", () => {
  const strategy = new SimpleRunnerStrategy();
  let tmpDir: string;

  const baseArgs = [
    "--repo-id", "550e8400-e29b-41d4-a716-446655440000",
    "--worktree-id", "660e8400-e29b-41d4-a716-446655440000",
    "--thread-id", "770e8400-e29b-41d4-a716-446655440000",
    "--mort-dir", "", // Will be set per test
    "--prompt", "test prompt",
    "--cwd", "", // Will be set per test
  ];

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mort-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    // Create a threads subdir for setup to use
    mkdirSync(join(tmpDir, "threads"), { recursive: true });
    vi.clearAllMocks();
    // Set ANTHROPIC_API_KEY so naming services can be called
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe("parseArgs", () => {
    it("sets skipNaming to true when --skip-naming is present", () => {
      const args = [...baseArgs, "--skip-naming"];
      args[args.indexOf("--mort-dir") + 1] = tmpDir;
      args[args.indexOf("--cwd") + 1] = tmpDir;
      const config = strategy.parseArgs(args);
      expect(config.skipNaming).toBe(true);
    });

    it("leaves skipNaming undefined when --skip-naming is absent", () => {
      const args = [...baseArgs];
      args[args.indexOf("--mort-dir") + 1] = tmpDir;
      args[args.indexOf("--cwd") + 1] = tmpDir;
      const config = strategy.parseArgs(args);
      expect(config.skipNaming).toBeUndefined();
    });
  });

  /** Build args with tmpDir already set for --mort-dir and --cwd */
  function buildArgs(extra: string[] = []): string[] {
    return [
      "--repo-id", "550e8400-e29b-41d4-a716-446655440000",
      "--worktree-id", "660e8400-e29b-41d4-a716-446655440000",
      "--thread-id", "770e8400-e29b-41d4-a716-446655440000",
      "--mort-dir", tmpDir,
      "--prompt", "test prompt",
      "--cwd", tmpDir,
      ...extra,
    ];
  }

  describe("setup with skipNaming", () => {
    it("skips thread and worktree naming when skipNaming is true", async () => {
      const config = strategy.parseArgs(buildArgs(["--skip-naming"]));

      await strategy.setup(config);

      // Should log skip message
      expect(emitLog).toHaveBeenCalledWith(
        "INFO",
        expect.stringContaining("Skipping thread and worktree naming")
      );

      // Should NOT have called naming services
      expect(generateThreadName).not.toHaveBeenCalled();
      expect(generateWorktreeName).not.toHaveBeenCalled();
    });

    it("calls naming services when skipNaming is not set", async () => {
      const config = strategy.parseArgs(buildArgs());

      await strategy.setup(config);

      // Should have called thread naming (fire and forget, so it's called but may not complete)
      expect(generateThreadName).toHaveBeenCalledWith("test prompt", "test-key");
    });
  });
});
