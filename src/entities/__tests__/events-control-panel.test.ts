/**
 * Event Types Control Panel Verification Tests
 *
 * Verifies that events.ts has been updated:
 * - OpenControlPanelPayload type exists (not OpenSimpleTaskPayload)
 * - ControlPanelViewType type exists (not SimpleTaskViewType)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Event Types Control Panel", () => {
  const projectRoot = process.cwd();

  it("should export OpenControlPanelPayload type", () => {
    const eventsPath = path.join(projectRoot, "src/entities/events.ts");
    const content = fs.readFileSync(eventsPath, "utf-8");
    expect(content).toContain("OpenControlPanelPayload");
    expect(content).not.toContain("OpenSimpleTaskPayload");
  });

  it("should export ControlPanelViewType type", () => {
    const eventsPath = path.join(projectRoot, "src/entities/events.ts");
    const content = fs.readFileSync(eventsPath, "utf-8");
    expect(content).toContain("ControlPanelViewType");
    expect(content).not.toContain("SimpleTaskViewType");
  });
});
