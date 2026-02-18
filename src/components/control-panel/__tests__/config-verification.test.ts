// @vitest-environment node
/**
 * Control Panel Configuration Verification Tests
 *
 * Verifies configuration files are updated:
 * - vite.config.ts has control-panel entry
 * - tauri.conf.json has control-panel window (or no simple-task window)
 * - capabilities/default.json has no simple-task references
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Control Panel Configuration", () => {
  const projectRoot = process.cwd();

  it("should have control-panel entry in vite.config.ts", () => {
    const viteConfig = fs.readFileSync(
      path.join(projectRoot, "vite.config.ts"),
      "utf-8"
    );
    // Check for control-panel entry (quotes may be single or double)
    expect(viteConfig).toMatch(/["']control-panel["']/);
    expect(viteConfig).toContain("control-panel.html");
    // Check no simple-task references
    expect(viteConfig).not.toMatch(/["']simple-task["']/);
    expect(viteConfig).not.toContain("simple-task.html");
  });

  it("should not have simple-task window references in tauri.conf.json", () => {
    const tauriConfig = fs.readFileSync(
      path.join(projectRoot, "src-tauri/tauri.conf.json"),
      "utf-8"
    );
    // Check for absence of simple-task
    expect(tauriConfig).not.toContain("simple-task");
  });

  it("should reference control-panel in capabilities if applicable", () => {
    const capabilitiesPath = path.join(
      projectRoot,
      "src-tauri/capabilities/default.json"
    );
    if (fs.existsSync(capabilitiesPath)) {
      const content = fs.readFileSync(capabilitiesPath, "utf-8");
      expect(content).not.toContain("simple-task");
    }
  });
});
