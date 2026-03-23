import { describe, it, expect } from "vitest";
import { extractFileChange } from "./file-changes.js";

describe("extractFileChange", () => {
  it("extracts Write as create operation", () => {
    const result = extractFileChange("Write", { file_path: "/tmp/foo.ts" }, "/tmp");
    expect(result).toEqual({ path: "/tmp/foo.ts", operation: "create" });
  });

  it("extracts Edit as modify operation", () => {
    const result = extractFileChange("Edit", { file_path: "/tmp/bar.ts" }, "/tmp");
    expect(result).toEqual({ path: "/tmp/bar.ts", operation: "modify" });
  });

  it("extracts NotebookEdit via notebook_path", () => {
    const result = extractFileChange("NotebookEdit", { notebook_path: "/tmp/nb.ipynb" }, "/tmp");
    expect(result).toEqual({ path: "/tmp/nb.ipynb", operation: "modify" });
  });

  it("returns null for non-file-modifying tools", () => {
    expect(extractFileChange("Bash", { command: "ls" }, "/tmp")).toBeNull();
    expect(extractFileChange("Read", { file_path: "/tmp/foo" }, "/tmp")).toBeNull();
  });

  it("returns null when no file path in input", () => {
    expect(extractFileChange("Write", {}, "/tmp")).toBeNull();
  });

  it("handles MultiEdit", () => {
    const result = extractFileChange("MultiEdit", { file_path: "/tmp/x.ts" }, "/tmp");
    expect(result).toEqual({ path: "/tmp/x.ts", operation: "modify" });
  });
});
