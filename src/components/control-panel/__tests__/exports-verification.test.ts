/**
 * Control Panel Exports Verification Tests
 *
 * Verifies that control panel components are properly exported:
 * - ControlPanelWindow component exists
 * - ControlPanelHeader component exists
 * - useControlPanelParams hook exists
 * - No SimpleTask named exports
 *
 * Note: Uses file content checks instead of dynamic imports since the codebase
 * is in a transitional state with some deleted dependencies.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Control Panel Exports", () => {
  const projectRoot = process.cwd();
  const controlPanelDir = path.join(projectRoot, "src/components/control-panel");

  it("should have ControlPanelWindow component file with export", () => {
    const filePath = path.join(controlPanelDir, "control-panel-window.tsx");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toMatch(/export\s+(function|const)\s+ControlPanelWindow/);
  });

  it("should have ControlPanelHeader component file with export", () => {
    const filePath = path.join(controlPanelDir, "control-panel-header.tsx");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toMatch(/export\s+(function|const)\s+ControlPanelHeader/);
  });

  it("should have useControlPanelParams hook file with export", () => {
    const filePath = path.join(controlPanelDir, "use-control-panel-params.ts");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toMatch(/export\s+(function|const)\s+useControlPanelParams/);
  });

  it("should have useControlPanelStore in store file", () => {
    const filePath = path.join(controlPanelDir, "store.ts");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("useControlPanelStore");
  });

  it("should have PlanViewHeader component file with export", () => {
    const filePath = path.join(controlPanelDir, "plan-view-header.tsx");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toMatch(/export\s+(function|const)\s+PlanViewHeader/);
  });

  it("should have PlanView component file with export", () => {
    const filePath = path.join(controlPanelDir, "plan-view.tsx");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toMatch(/export\s+(function|const)\s+PlanView/);
  });

  it("should have PlanInputArea component file with export", () => {
    const filePath = path.join(controlPanelDir, "plan-input-area.tsx");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toMatch(/export\s+(function|const)\s+PlanInputArea/);
  });

  it("should not export any SimpleTask named exports from index", () => {
    const filePath = path.join(controlPanelDir, "index.ts");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    // Check that no SimpleTask names are exported
    expect(content).not.toMatch(/SimpleTask/);
  });
});
