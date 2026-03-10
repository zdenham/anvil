import { describe, it, expect } from "vitest";
import {
  PermissionEvaluator,
  GLOBAL_OVERRIDES,
} from "../permission-evaluator.js";
import {
  PLAN_MODE,
  IMPLEMENT_MODE,
  APPROVE_MODE,
} from "@core/types/permissions.js";
import type { PermissionConfig } from "@core/types/permissions.js";

const WORKING_DIR = "/Users/zac/project";

function makeConfig(
  overrides: Partial<PermissionConfig> = {},
): PermissionConfig {
  return {
    mode: PLAN_MODE,
    overrides: [],
    workingDirectory: WORKING_DIR,
    ...overrides,
  };
}

// ── Rule Matching ──────────────────────────────────────────────────

describe("PermissionEvaluator", () => {
  describe("rule matching", () => {
    it("Plan mode: Read tool -> allow", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("Read", { file_path: "/Users/zac/project/src/app.tsx" });
      expect(result.decision).toBe("allow");
    });

    it("Plan mode: Write to plans/readme.md -> allow", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("Write", {
        file_path: "/Users/zac/project/plans/readme.md",
      });
      expect(result.decision).toBe("allow");
    });

    it("Plan mode: Write to src/app.tsx -> deny with reason", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("Write", {
        file_path: "/Users/zac/project/src/app.tsx",
      });
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain("Plan mode");
    });

    it("Implement mode: Write to anything -> allow", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({ mode: IMPLEMENT_MODE }),
      );
      const result = evaluator.evaluate("Write", {
        file_path: "/Users/zac/project/src/app.tsx",
      });
      expect(result.decision).toBe("allow");
    });

    it("Approve mode: Write to anything -> ask", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({ mode: APPROVE_MODE }),
      );
      const result = evaluator.evaluate("Write", {
        file_path: "/Users/zac/project/src/app.tsx",
      });
      expect(result.decision).toBe("ask");
    });

    it("Approve mode: Read tool -> allow", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({ mode: APPROVE_MODE }),
      );
      const result = evaluator.evaluate("Read", {
        file_path: "/Users/zac/project/src/app.tsx",
      });
      expect(result.decision).toBe("allow");
    });
  });

  // ── Path Normalization ─────────────────────────────────────────

  describe("path normalization", () => {
    it("normalizes absolute path to relative using workingDirectory", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      // Write to plans/ should be allowed in plan mode — proves path was normalized
      const result = evaluator.evaluate("Write", {
        file_path: "/Users/zac/project/plans/foo.md",
      });
      expect(result.decision).toBe("allow");
    });

    it("path already relative is returned as-is", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("Write", {
        file_path: "plans/foo.md",
      });
      expect(result.decision).toBe("allow");
    });

    it("path outside working directory is returned as-is", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      // Path outside working dir does not start with "plans/" so it gets denied
      const result = evaluator.evaluate("Write", {
        file_path: "/other/project/plans/foo.md",
      });
      // "/other/project/plans/foo.md" doesn't start with workingDir so kept as-is
      // It does contain "plans/" though, so the regex ^plans/ won't match the leading /
      expect(result.decision).toBe("deny");
    });
  });

  // ── Overrides Take Precedence ──────────────────────────────────

  describe("overrides take precedence", () => {
    it("Implement mode + .env write -> deny (override wins)", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({ mode: IMPLEMENT_MODE }),
      );
      const result = evaluator.evaluate("Write", {
        file_path: "/Users/zac/project/.env",
      });
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain(".env");
    });

    it("Implement mode + rm -rf .git -> deny (override wins)", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({ mode: IMPLEMENT_MODE }),
      );
      const result = evaluator.evaluate("Bash", {
        command: "rm -rf .git",
      });
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain(".git");
    });

    it("Edit .env.local also triggers .env override", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({ mode: IMPLEMENT_MODE }),
      );
      const result = evaluator.evaluate("Edit", {
        file_path: "/Users/zac/project/.env.local",
      });
      expect(result.decision).toBe("deny");
    });

    it("custom overrides are prepended after global overrides", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({
          mode: IMPLEMENT_MODE,
          overrides: [
            {
              toolPattern: "^Bash$",
              commandPattern: "^docker",
              decision: "deny",
              reason: "Docker not allowed",
            },
          ],
        }),
      );
      const result = evaluator.evaluate("Bash", { command: "docker build ." });
      expect(result.decision).toBe("deny");
      expect(result.reason).toBe("Docker not allowed");
    });
  });

  // ── Mode Switching ─────────────────────────────────────────────

  describe("mode switching", () => {
    it("setMode changes evaluation results", () => {
      const evaluator = new PermissionEvaluator(makeConfig());

      // Plan mode: Write to src/ denied
      const planResult = evaluator.evaluate("Write", {
        file_path: "/Users/zac/project/src/app.tsx",
      });
      expect(planResult.decision).toBe("deny");

      // Switch to Implement mode
      evaluator.setMode(IMPLEMENT_MODE);

      const implResult = evaluator.evaluate("Write", {
        file_path: "/Users/zac/project/src/app.tsx",
      });
      expect(implResult.decision).toBe("allow");
    });

    it("getModeId returns correct ID after switch", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      expect(evaluator.getModeId()).toBe("plan");

      evaluator.setMode(IMPLEMENT_MODE);
      expect(evaluator.getModeId()).toBe("implement");

      evaluator.setMode(APPROVE_MODE);
      expect(evaluator.getModeId()).toBe("approve");
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────

  describe("edge cases", () => {
    it("tool input with no file_path (e.g. WebSearch) -> pathPattern rules skip", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("WebSearch", {
        query: "hello world",
      });
      // WebSearch matches the read/search allow rule in plan mode
      expect(result.decision).toBe("allow");
    });

    it("tool input with null -> does not crash", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("Read", null);
      // Read matches the allow rule even without file_path since
      // the rule has no pathPattern constraint
      expect(result.decision).toBe("allow");
    });

    it("unknown tool name -> hits mode default decision", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("SomeUnknownTool", {});
      // Plan mode default is deny
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain("Plan mode");
    });

    it("unknown tool in implement mode -> hits allow default", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({ mode: IMPLEMENT_MODE }),
      );
      const result = evaluator.evaluate("SomeUnknownTool", {});
      expect(result.decision).toBe("allow");
    });

    it("Glob tool uses path field for file path extraction", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("Glob", {
        path: "/Users/zac/project/src",
      });
      expect(result.decision).toBe("allow");
    });

    it("Bash tool in plan mode -> allow", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("Bash", {
        command: "ls -la",
      });
      expect(result.decision).toBe("allow");
    });

    it("Task tool in plan mode -> allow", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("Task", {});
      expect(result.decision).toBe("allow");
    });
  });

  // ── Global Overrides Constants ─────────────────────────────────

  describe("GLOBAL_OVERRIDES", () => {
    it("contains .git deletion override", () => {
      const gitRule = GLOBAL_OVERRIDES.find((r) =>
        r.reason?.includes(".git"),
      );
      expect(gitRule).toBeDefined();
      expect(gitRule!.decision).toBe("deny");
    });

    it("contains .env modification override", () => {
      const envRule = GLOBAL_OVERRIDES.find((r) =>
        r.reason?.includes(".env"),
      );
      expect(envRule).toBeDefined();
      expect(envRule!.decision).toBe("deny");
    });

    it("contains EnterWorktree override", () => {
      const worktreeRule = GLOBAL_OVERRIDES.find((r) =>
        r.toolPattern === "^EnterWorktree$",
      );
      expect(worktreeRule).toBeDefined();
      expect(worktreeRule!.decision).toBe("deny");
    });
  });

  // ── EnterWorktree Denial ───────────────────────────────────────

  describe("EnterWorktree denial", () => {
    it("EnterWorktree is denied in implement mode", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({ mode: IMPLEMENT_MODE }),
      );
      const result = evaluator.evaluate("EnterWorktree", {});
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain("Worktree creation is managed by Mort");
    });

    it("EnterWorktree is denied in plan mode", () => {
      const evaluator = new PermissionEvaluator(makeConfig());
      const result = evaluator.evaluate("EnterWorktree", {});
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain("Worktree creation is managed by Mort");
    });

    it("EnterWorktree is denied in approve mode", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({ mode: APPROVE_MODE }),
      );
      const result = evaluator.evaluate("EnterWorktree", {});
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain("Worktree creation is managed by Mort");
    });

    it("EnterWorktree denial overrides custom allow rules", () => {
      const evaluator = new PermissionEvaluator(
        makeConfig({
          mode: IMPLEMENT_MODE,
          overrides: [
            {
              toolPattern: "^EnterWorktree$",
              decision: "allow",
              reason: "Custom allow",
            },
          ],
        }),
      );
      // Global override fires first, custom allow never reached
      const result = evaluator.evaluate("EnterWorktree", {});
      expect(result.decision).toBe("deny");
    });
  });
});
