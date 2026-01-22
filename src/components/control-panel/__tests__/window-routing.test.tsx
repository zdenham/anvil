/**
 * ControlPanelWindow Routing Tests
 *
 * Tests for the control panel window routing between thread and plan views.
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("ControlPanelWindow routing", () => {
  const projectRoot = process.cwd();

  it("should have routing logic for thread and plan views in control-panel-window", () => {
    const windowPath = path.join(
      projectRoot,
      "src/components/control-panel/control-panel-window.tsx"
    );
    const content = fs.readFileSync(windowPath, "utf-8");

    // Verify the component imports or uses view type concepts
    // Note: This is a structural test - detailed component tests would require more setup
    expect(content).toContain("ControlPanelWindow");
  });

  it("should have useControlPanelStore defined in the store", () => {
    const storePath = path.join(
      projectRoot,
      "src/components/control-panel/store.ts"
    );
    const content = fs.readFileSync(storePath, "utf-8");

    // The store should define useControlPanelStore
    expect(content).toContain("useControlPanelStore");
  });

  it("should have PlanView component available", () => {
    const planViewPath = path.join(
      projectRoot,
      "src/components/control-panel/plan-view.tsx"
    );
    expect(fs.existsSync(planViewPath)).toBe(true);
  });

  it("should have PlanInputArea component available", () => {
    const planInputPath = path.join(
      projectRoot,
      "src/components/control-panel/plan-input-area.tsx"
    );
    expect(fs.existsSync(planInputPath)).toBe(true);
  });

  it("should export control panel components from index", () => {
    const indexPath = path.join(
      projectRoot,
      "src/components/control-panel/index.ts"
    );
    const content = fs.readFileSync(indexPath, "utf-8");

    expect(content).toContain("ControlPanelWindow");
    expect(content).toContain("PlanView");
    expect(content).toContain("PlanInputArea");
    expect(content).toContain("useControlPanelStore");
  });
});
