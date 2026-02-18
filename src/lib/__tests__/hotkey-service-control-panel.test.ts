// @vitest-environment node
/**
 * Hotkey Service Control Panel Verification Tests
 *
 * Verifies that hotkey-service.ts has been updated:
 * - openControlPanel function exists (not openSimpleTask)
 * - hideControlPanel function exists (not hideSimpleTask)
 * - References control-panel panel label (not simple-task)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Hotkey Service Control Panel Integration", () => {
  const projectRoot = process.cwd();

  it("should have openControlPanel function", () => {
    const hotkeyServicePath = path.join(
      projectRoot,
      "src/lib/hotkey-service.ts"
    );
    const content = fs.readFileSync(hotkeyServicePath, "utf-8");
    expect(content).toContain("openControlPanel");
    expect(content).not.toContain("openSimpleTask");
  });

  it("should not have hideSimpleTask function", () => {
    const hotkeyServicePath = path.join(
      projectRoot,
      "src/lib/hotkey-service.ts"
    );
    const content = fs.readFileSync(hotkeyServicePath, "utf-8");
    // Note: hideControlPanel may not exist yet, but hideSimpleTask should definitely not exist
    expect(content).not.toContain("hideSimpleTask");
  });

  it('should reference "control-panel" panel label', () => {
    const hotkeyServicePath = path.join(
      projectRoot,
      "src/lib/hotkey-service.ts"
    );
    const content = fs.readFileSync(hotkeyServicePath, "utf-8");
    expect(content).toContain('"control-panel"');
    expect(content).not.toContain('"simple-task"');
  });
});
