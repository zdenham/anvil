import { describe, it, expect, vi, afterEach } from "vitest";
import { getHubSocketPath } from "./socket.js";
import * as mortDir from "./mort-dir.js";

describe("getHubSocketPath", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: Returns correct path structure
  it("should return path ending with agent-hub.sock", () => {
    const result = getHubSocketPath();
    expect(result).toMatch(/agent-hub\.sock$/);
  });

  // Test 2: Path is built from mort directory
  it("should build path from getMortDir()", () => {
    const getMortDirSpy = vi.spyOn(mortDir, "getMortDir");
    getMortDirSpy.mockReturnValue("/custom/mort/dir");

    const result = getHubSocketPath();

    expect(result).toBe("/custom/mort/dir/agent-hub.sock");
  });

  // Test 3: Returns absolute path (not relative)
  it("should return an absolute path", () => {
    const result = getHubSocketPath();
    expect(result.startsWith("/")).toBe(true);
  });

  // Test 4: Path does not contain unexpanded tilde
  it("should not contain unexpanded tilde", () => {
    const result = getHubSocketPath();
    expect(result).not.toContain("~");
  });

  // Test 5: Consistent return value (idempotent)
  it("should return the same path on repeated calls", () => {
    const result1 = getHubSocketPath();
    const result2 = getHubSocketPath();
    expect(result1).toBe(result2);
  });

  // Test 6: Handles mort directory with spaces
  it("should handle mort directory with spaces in path", () => {
    const getMortDirSpy = vi.spyOn(mortDir, "getMortDir");
    getMortDirSpy.mockReturnValue("/path with spaces/.mort");

    const result = getHubSocketPath();

    expect(result).toBe("/path with spaces/.mort/agent-hub.sock");
  });

  // Test 7: Handles mort directory with special characters
  it("should handle mort directory with special characters", () => {
    const getMortDirSpy = vi.spyOn(mortDir, "getMortDir");
    getMortDirSpy.mockReturnValue("/path-with_special.chars/.mort");

    const result = getHubSocketPath();

    expect(result).toBe("/path-with_special.chars/.mort/agent-hub.sock");
  });

  // Test 8: No double slashes when mort dir ends without slash
  it("should not create double slashes in path", () => {
    const getMortDirSpy = vi.spyOn(mortDir, "getMortDir");
    getMortDirSpy.mockReturnValue("/home/user/.mort");

    const result = getHubSocketPath();

    expect(result).not.toContain("//");
    expect(result).toBe("/home/user/.mort/agent-hub.sock");
  });
});
