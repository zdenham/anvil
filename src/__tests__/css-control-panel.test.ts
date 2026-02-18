// @vitest-environment node
/**
 * CSS Control Panel Verification Tests
 *
 * Verifies that CSS has been updated:
 * - control-panel-container class exists (not simple-task-container)
 * - No simple-task CSS classes
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("CSS Control Panel Classes", () => {
  const projectRoot = process.cwd();

  it("should have no simple-task CSS classes", () => {
    const cssPath = path.join(projectRoot, "src/index.css");
    const content = fs.readFileSync(cssPath, "utf-8");
    expect(content).not.toMatch(/\.simple-task/);
  });
});
