import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnvilReplRunner } from "../repl-runner.js";
import type { ReplContext, ReplResult } from "../types.js";

vi.mock("../../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockContext: ReplContext = {
  threadId: "test-thread-id",
  repoId: "test-repo-id",
  worktreeId: "test-worktree-id",
  workingDir: "/test/dir",
  permissionModeId: "implement",
  anvilDir: "/test/.anvil",
};

describe("AnvilReplRunner", () => {
  let runner: AnvilReplRunner;

  beforeEach(() => {
    runner = new AnvilReplRunner();
  });

  // ── extractCode() ──────────────────────────────────────────

  describe("extractCode", () => {
    it("extracts code from single-quote heredoc", () => {
      const command = `anvil-repl <<'ANVIL_REPL'\nconst x = 1;\nreturn x;\nANVIL_REPL`;
      expect(runner.extractCode(command)).toBe("const x = 1;\nreturn x;");
    });

    it("extracts code from double-quote heredoc delimiter", () => {
      const command = `anvil-repl <<"DELIM"\nconst y = 2;\nDELIM`;
      expect(runner.extractCode(command)).toBe("const y = 2;");
    });

    it("extracts code from unquoted heredoc delimiter", () => {
      const command = `anvil-repl <<EOF\nreturn 99;\nEOF`;
      expect(runner.extractCode(command)).toBe("return 99;");
    });

    it("extracts code from double-quoted string", () => {
      expect(runner.extractCode('anvil-repl "return 42"')).toBe("return 42");
    });

    it("extracts code from single-quoted string", () => {
      expect(runner.extractCode("anvil-repl 'return 42'")).toBe("return 42");
    });

    it("returns null for non-anvil-repl commands", () => {
      expect(runner.extractCode("ls -la")).toBeNull();
    });

    it("returns null for bare anvil-repl with no code body", () => {
      expect(runner.extractCode("anvil-repl")).toBeNull();
    });

    it("handles leading whitespace in command", () => {
      expect(runner.extractCode('  anvil-repl "return 1"')).toBe("return 1");
    });
  });

  // ── transpile() ────────────────────────────────────────────

  describe("transpile", () => {
    it("passes through plain JavaScript unchanged", () => {
      const code = "const x = 1 + 1;";
      const result = runner.transpile(code);
      expect(result.trim()).toBe("const x = 1 + 1;");
    });

    it("strips TypeScript type annotations", () => {
      const code = "const x: number = 42;";
      const result = runner.transpile(code);
      expect(result.trim()).toBe("const x = 42;");
    });

    it("preserves async/await syntax", () => {
      const code = "const x = await Promise.resolve(1);";
      const result = runner.transpile(code);
      expect(result).toContain("await");
      expect(result).toContain("Promise.resolve");
    });

    it("strips interface declarations", () => {
      const code = "interface Foo { bar: string; }\nconst x = 1;";
      const result = runner.transpile(code);
      expect(result).not.toContain("interface");
      expect(result).toContain("const x = 1;");
    });
  });

  // ── execute() ──────────────────────────────────────────────

  describe("execute", () => {
    it("returns success with simple return value", async () => {
      const result = await runner.execute("return 42", mockContext);
      expect(result.success).toBe(true);
      expect(result.value).toBe(42);
    });

    it("returns success with async code", async () => {
      const result = await runner.execute(
        "return await Promise.resolve('hello')",
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.value).toBe("hello");
    });

    it("captures anvil.log calls", async () => {
      const result = await runner.execute(
        "anvil.log('test message'); return 'done'",
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.value).toBe("done");
      expect(result.logs).toContain("test message");
    });

    it("returns failure on thrown error", async () => {
      const result = await runner.execute(
        "throw new Error('boom')",
        mockContext,
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("boom");
    });

    it("makes anvil.context accessible with correct threadId", async () => {
      const result = await runner.execute(
        "return anvil.context.threadId",
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.value).toBe("test-thread-id");
    });

    it("includes durationMs in result", async () => {
      const result = await runner.execute("return 1", mockContext);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("handles TypeScript code via transpilation", async () => {
      const code = "const x: number = 10;\nreturn x;";
      const result = await runner.execute(code, mockContext);
      expect(result.success).toBe(true);
      expect(result.value).toBe(10);
    });

    it("uses provided SDK when given", async () => {
      const customLogs: string[] = [];
      const customSdk = {
        spawn: vi.fn(),
        log: (msg: string) => customLogs.push(msg),
        context: { ...mockContext },
        logs: customLogs,
      };

      const result = await runner.execute(
        "anvil.log('via-sdk'); return 'ok'",
        mockContext,
        customSdk,
      );
      expect(result.success).toBe(true);
      expect(customLogs).toContain("via-sdk");
    });
  });

  // ── formatResult() ─────────────────────────────────────────

  describe("formatResult", () => {
    it("formats successful result with value", () => {
      const result: ReplResult = {
        success: true,
        value: 42,
        logs: [],
        durationMs: 10,
      };
      const output = runner.formatResult(result);
      expect(output).toMatch(/^anvil-repl result:/);
      expect(output).toContain("42");
    });

    it("formats error result", () => {
      const result: ReplResult = {
        success: false,
        value: undefined,
        logs: [],
        error: "boom",
        durationMs: 5,
      };
      const output = runner.formatResult(result);
      expect(output).toMatch(/^anvil-repl error:/);
      expect(output).toContain("boom");
    });

    it("truncates output over 50KB", () => {
      const bigValue = "x".repeat(60 * 1024);
      const result: ReplResult = {
        success: true,
        value: bigValue,
        logs: [],
        durationMs: 1,
      };
      const output = runner.formatResult(result);
      expect(output).toContain("... [truncated]");
      expect(output.length).toBeLessThanOrEqual(50 * 1024 + 100);
    });

    it("includes logs in output", () => {
      const result: ReplResult = {
        success: true,
        value: "ok",
        logs: ["log-line-1", "log-line-2"],
        durationMs: 1,
      };
      const output = runner.formatResult(result);
      expect(output).toContain("log-line-1");
      expect(output).toContain("log-line-2");
    });

    it("shows 'Unknown error' when error field is missing", () => {
      const result: ReplResult = {
        success: false,
        value: undefined,
        logs: [],
        durationMs: 1,
      };
      const output = runner.formatResult(result);
      expect(output).toContain("Unknown error");
    });

    it("serializes object values as JSON", () => {
      const result: ReplResult = {
        success: true,
        value: { foo: "bar" },
        logs: [],
        durationMs: 1,
      };
      const output = runner.formatResult(result);
      expect(output).toContain('"foo"');
      expect(output).toContain('"bar"');
    });

    it("handles undefined value", () => {
      const result: ReplResult = {
        success: true,
        value: undefined,
        logs: [],
        durationMs: 1,
      };
      const output = runner.formatResult(result);
      expect(output).toContain("undefined");
    });
  });
});
