import { describe, it, expect } from "vitest";
import { createSafeGitHook } from "../safe-git-hook.js";

function makeHookInput(command: string) {
  return {
    tool_name: "Bash",
    tool_use_id: "tool-use-abc",
    tool_input: { command },
  };
}

type HookResult =
  | { continue: true }
  | { reason: string; hookSpecificOutput: { permissionDecision: string } };

describe("createSafeGitHook", () => {
  const hook = createSafeGitHook();

  // git stash variants
  describe("git stash", () => {
    it("blocks git stash", async () => {
      const result = (await hook(makeHookInput("git stash"))) as HookResult;
      expect(result).toHaveProperty("reason");
      expect((result as { reason: string }).reason).toContain("BLOCKED");
    });

    it("blocks git stash push", async () => {
      const result = (await hook(makeHookInput("git stash push"))) as HookResult;
      expect(result).toHaveProperty("reason");
    });

    it("blocks git stash pop", async () => {
      const result = (await hook(makeHookInput("git stash pop"))) as HookResult;
      expect(result).toHaveProperty("reason");
    });

    it("blocks git stash drop", async () => {
      const result = (await hook(makeHookInput("git stash drop"))) as HookResult;
      expect(result).toHaveProperty("reason");
    });

    it("allows git stash list", async () => {
      const result = await hook(makeHookInput("git stash list"));
      expect(result).toEqual({ continue: true });
    });

    it("allows git stash show", async () => {
      const result = await hook(makeHookInput("git stash show"));
      expect(result).toEqual({ continue: true });
    });
  });

  // git checkout --force
  describe("git checkout --force", () => {
    it("blocks git checkout --force main", async () => {
      const result = await hook(makeHookInput("git checkout --force main"));
      expect(result).toHaveProperty("reason");
    });

    it("blocks git checkout -f main", async () => {
      const result = await hook(makeHookInput("git checkout -f main"));
      expect(result).toHaveProperty("reason");
    });

    it("allows git checkout main (no force)", async () => {
      const result = await hook(makeHookInput("git checkout main"));
      expect(result).toEqual({ continue: true });
    });

    it("allows git checkout -b new-branch", async () => {
      const result = await hook(makeHookInput("git checkout -b new-branch"));
      expect(result).toEqual({ continue: true });
    });
  });

  // git reset --hard
  describe("git reset --hard", () => {
    it("blocks git reset --hard", async () => {
      const result = await hook(makeHookInput("git reset --hard"));
      expect(result).toHaveProperty("reason");
    });

    it("blocks git reset --hard HEAD~1", async () => {
      const result = await hook(makeHookInput("git reset --hard HEAD~1"));
      expect(result).toHaveProperty("reason");
    });

    it("allows git reset --soft HEAD~1", async () => {
      const result = await hook(makeHookInput("git reset --soft HEAD~1"));
      expect(result).toEqual({ continue: true });
    });

    it("allows git reset HEAD file.txt", async () => {
      const result = await hook(makeHookInput("git reset HEAD file.txt"));
      expect(result).toEqual({ continue: true });
    });
  });

  // git clean -f
  describe("git clean -f", () => {
    it("blocks git clean -f", async () => {
      const result = await hook(makeHookInput("git clean -f"));
      expect(result).toHaveProperty("reason");
    });

    it("blocks git clean -fd", async () => {
      const result = await hook(makeHookInput("git clean -fd"));
      expect(result).toHaveProperty("reason");
    });

    it("blocks git clean -xfd", async () => {
      const result = await hook(makeHookInput("git clean -xfd"));
      expect(result).toHaveProperty("reason");
    });

    it("allows git clean -n (dry run)", async () => {
      const result = await hook(makeHookInput("git clean -n"));
      expect(result).toEqual({ continue: true });
    });
  });

  // git checkout -- .
  describe("git checkout -- .", () => {
    it("blocks git checkout -- .", async () => {
      const result = await hook(makeHookInput("git checkout -- ."));
      expect(result).toHaveProperty("reason");
    });

    it("allows git checkout -- specific-file.ts", async () => {
      const result = await hook(makeHookInput("git checkout -- specific-file.ts"));
      expect(result).toEqual({ continue: true });
    });
  });

  // git restore .
  describe("git restore .", () => {
    it("blocks git restore .", async () => {
      const result = await hook(makeHookInput("git restore ."));
      expect(result).toHaveProperty("reason");
    });

    it("allows git restore specific-file.ts", async () => {
      const result = await hook(makeHookInput("git restore specific-file.ts"));
      expect(result).toEqual({ continue: true });
    });
  });

  // Safe commands pass through
  describe("safe commands", () => {
    it("allows git status", async () => {
      const result = await hook(makeHookInput("git status"));
      expect(result).toEqual({ continue: true });
    });

    it("allows git diff", async () => {
      const result = await hook(makeHookInput("git diff"));
      expect(result).toEqual({ continue: true });
    });

    it("allows git log", async () => {
      const result = await hook(makeHookInput("git log --oneline"));
      expect(result).toEqual({ continue: true });
    });

    it("allows git add", async () => {
      const result = await hook(makeHookInput("git add ."));
      expect(result).toEqual({ continue: true });
    });

    it("allows git commit", async () => {
      const result = await hook(makeHookInput('git commit -m "test"'));
      expect(result).toEqual({ continue: true });
    });

    it("allows non-git commands", async () => {
      const result = await hook(makeHookInput("ls -la"));
      expect(result).toEqual({ continue: true });
    });
  });

  // Deny response shape
  describe("deny response shape", () => {
    it("returns correct hookSpecificOutput structure", async () => {
      const result = (await hook(makeHookInput("git stash"))) as {
        reason: string;
        hookSpecificOutput: {
          hookEventName: string;
          permissionDecision: string;
          permissionDecisionReason: string;
        };
      };

      expect(result.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(result.hookSpecificOutput.permissionDecisionReason).toContain("Destructive git command blocked");
    });

    it("includes suggestion in reason", async () => {
      const result = (await hook(makeHookInput("git stash"))) as { reason: string };
      expect(result.reason).toContain("Suggestion:");
    });
  });
});
