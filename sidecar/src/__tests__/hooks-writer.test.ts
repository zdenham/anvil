/**
 * Tests for dynamic hooks.json writer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeHooksJson, buildHooksConfig } from "../hooks/hooks-writer.js";

describe("hooks-writer", () => {
  let anvilDir: string;

  beforeEach(() => {
    anvilDir = join(tmpdir(), `anvil-hooks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(anvilDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(anvilDir, { recursive: true, force: true });
  });

  describe("buildHooksConfig", () => {
    it("builds config with correct URLs", () => {
      const config = buildHooksConfig("http://localhost:9603");

      expect(config.SessionStart[0].hooks[0].url).toBe("http://localhost:9603/hooks/session-start");
      expect(config.PreToolUse[0].hooks[0].url).toBe("http://localhost:9603/hooks/pre-tool-use");
      expect(config.PostToolUse[0].hooks[0].url).toBe("http://localhost:9603/hooks/post-tool-use");
      expect(config.Stop[0].hooks[0].url).toBe("http://localhost:9603/hooks/stop");
    });

    it("includes thread ID header with env var interpolation", () => {
      const config = buildHooksConfig("http://localhost:9603");
      const hook = config.PreToolUse[0].hooks[0];

      expect(hook.headers["X-Anvil-Thread-Id"]).toBe("$ANVIL_THREAD_ID");
      expect(hook.allowedEnvVars).toContain("ANVIL_THREAD_ID");
    });

    it("sets 10s timeout on all hooks", () => {
      const config = buildHooksConfig("http://localhost:9603");

      for (const [, matchers] of Object.entries(config)) {
        for (const matcher of matchers) {
          for (const hook of matcher.hooks) {
            expect(hook.timeout).toBe(10);
          }
        }
      }
    });

    it("includes status messages on user-visible hooks", () => {
      const config = buildHooksConfig("http://localhost:9603");

      expect(config.SessionStart[0].hooks[0].statusMessage).toBe("Connecting to Anvil...");
      expect(config.PreToolUse[0].hooks[0].statusMessage).toBe("Checking with Anvil...");
      expect(config.PostToolUse[0].hooks[0].statusMessage).toBeUndefined();
      expect(config.Stop[0].hooks[0].statusMessage).toBeUndefined();
    });
  });

  describe("writeHooksJson", () => {
    it("creates hooks directory and writes hooks.json", () => {
      writeHooksJson(anvilDir, 9603);

      const hooksPath = join(anvilDir, "hooks", "hooks.json");
      expect(existsSync(hooksPath)).toBe(true);

      const content = JSON.parse(readFileSync(hooksPath, "utf-8"));
      expect(content.hooks.PreToolUse[0].hooks[0].url).toBe("http://localhost:9603/hooks/pre-tool-use");
    });

    it("overwrites existing hooks.json on port change", () => {
      writeHooksJson(anvilDir, 9600);
      writeHooksJson(anvilDir, 9601);

      const hooksPath = join(anvilDir, "hooks", "hooks.json");
      const content = JSON.parse(readFileSync(hooksPath, "utf-8"));
      expect(content.hooks.PreToolUse[0].hooks[0].url).toContain("9601");
    });
  });
});
