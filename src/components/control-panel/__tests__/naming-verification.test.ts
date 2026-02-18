// @vitest-environment node
/**
 * Control Panel Naming Convention Verification Tests
 *
 * Verifies that "simple-task" has been renamed to "control-panel" throughout:
 * - No files with "simple-task" in their names
 * - control-panel directory exists (not simple-task)
 * - control-panel.html exists (not simple-task.html)
 * - control-panel-main.tsx exists (not simple-task-main.tsx)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

describe("Control Panel Naming Convention", () => {
  const projectRoot = process.cwd();

  it("should have no files containing 'simple-task' in filename", async () => {
    const files = await glob("**/*simple-task*", {
      cwd: projectRoot,
      ignore: ["node_modules/**", "dist/**", "target/**", "plans/**"],
    });
    expect(files).toEqual([]);
  });

  it("should have control-panel directory instead of simple-task", () => {
    const controlPanelExists = fs.existsSync(
      path.join(projectRoot, "src/components/control-panel")
    );
    const simpleTaskExists = fs.existsSync(
      path.join(projectRoot, "src/components/simple-task")
    );
    expect(controlPanelExists).toBe(true);
    expect(simpleTaskExists).toBe(false);
  });

  it("should have control-panel.html instead of simple-task.html", () => {
    const controlPanelHtmlExists = fs.existsSync(
      path.join(projectRoot, "control-panel.html")
    );
    const simpleTaskHtmlExists = fs.existsSync(
      path.join(projectRoot, "simple-task.html")
    );
    expect(controlPanelHtmlExists).toBe(true);
    expect(simpleTaskHtmlExists).toBe(false);
  });

  it("should have control-panel-main.tsx instead of simple-task-main.tsx", () => {
    const controlPanelMainExists = fs.existsSync(
      path.join(projectRoot, "src/control-panel-main.tsx")
    );
    const simpleTaskMainExists = fs.existsSync(
      path.join(projectRoot, "src/simple-task-main.tsx")
    );
    expect(controlPanelMainExists).toBe(true);
    expect(simpleTaskMainExists).toBe(false);
  });
});
