import { describe, it, expect } from "vitest";
import { shouldFirePhaseReminder } from "../phase-reminder.js";
import type { PhaseInfo } from "@core/types/plans.js";

const baseOpts = {
  toolName: "Edit",
  filePath: "/project/src/foo.ts",
  workingDir: "/project",
  permissionModeId: "implement" as string | undefined,
  phaseInfo: { total: 3, completed: 1, phases: [] } as PhaseInfo | null,
  fileModCount: 5,
};

describe("shouldFirePhaseReminder", () => {
  it("returns true when all conditions met", () => {
    expect(shouldFirePhaseReminder(baseOpts)).toBe(true);
  });

  it("returns false when all phases complete", () => {
    expect(shouldFirePhaseReminder({
      ...baseOpts,
      phaseInfo: { total: 3, completed: 3, phases: [] },
    })).toBe(false);
  });

  it("returns false when throttle threshold not met", () => {
    expect(shouldFirePhaseReminder({
      ...baseOpts,
      fileModCount: 4,
    })).toBe(false);
  });

  it("returns false for plan file edits", () => {
    expect(shouldFirePhaseReminder({
      ...baseOpts,
      filePath: "/project/plans/my-plan.md",
    })).toBe(false);
  });

  it("returns false when no phase info", () => {
    expect(shouldFirePhaseReminder({
      ...baseOpts,
      phaseInfo: null,
    })).toBe(false);
  });

  it("returns false for non-file-modifying tools", () => {
    expect(shouldFirePhaseReminder({
      ...baseOpts,
      toolName: "Read",
    })).toBe(false);
  });

  it("returns false when not in implement mode", () => {
    expect(shouldFirePhaseReminder({
      ...baseOpts,
      permissionModeId: "plan",
    })).toBe(false);
  });

  it("returns false when permissionModeId is undefined", () => {
    expect(shouldFirePhaseReminder({
      ...baseOpts,
      permissionModeId: undefined,
    })).toBe(false);
  });

  it("returns false when filePath is undefined", () => {
    expect(shouldFirePhaseReminder({
      ...baseOpts,
      filePath: undefined,
    })).toBe(false);
  });
});
