import { describe, it, expect, vi, afterEach } from "vitest";
import {
  shouldRequestPermission,
  cleanupPermissionHandler,
} from "./permission-handler.js";

vi.mock("../runners/shared.js", () => ({
  emitEvent: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Permission Handler", () => {
  afterEach(() => {
    cleanupPermissionHandler();
  });

  describe("shouldRequestPermission", () => {
    it('returns false for "allow-all" mode', () => {
      expect(shouldRequestPermission("Write", "allow-all")).toBe(false);
      expect(shouldRequestPermission("Read", "allow-all")).toBe(false);
    });

    it('returns true for all tools in "ask-always" mode', () => {
      expect(shouldRequestPermission("Write", "ask-always")).toBe(true);
      expect(shouldRequestPermission("Read", "ask-always")).toBe(true);
      expect(shouldRequestPermission("Glob", "ask-always")).toBe(true);
    });

    it('returns true only for write tools in "ask-writes" mode', () => {
      expect(shouldRequestPermission("Write", "ask-writes")).toBe(true);
      expect(shouldRequestPermission("Edit", "ask-writes")).toBe(true);
      expect(shouldRequestPermission("Bash", "ask-writes")).toBe(true);
      expect(shouldRequestPermission("NotebookEdit", "ask-writes")).toBe(true);
      expect(shouldRequestPermission("Read", "ask-writes")).toBe(false);
      expect(shouldRequestPermission("Glob", "ask-writes")).toBe(false);
    });
  });
});
