/**
 * Event Bridge Control Panel Verification Tests
 *
 * Verifies that event-bridge.ts has been updated:
 * - open-control-panel event exists (not open-simple-task)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Event Bridge Control Panel Integration", () => {
  const projectRoot = process.cwd();

  it("should have open-control-panel event instead of open-simple-task", () => {
    const eventBridgePath = path.join(projectRoot, "src/lib/event-bridge.ts");
    const content = fs.readFileSync(eventBridgePath, "utf-8");
    expect(content).toContain("open-control-panel");
    expect(content).not.toContain("open-simple-task");
  });
});
