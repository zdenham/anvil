import { describe, it, expect } from "vitest";
import { sortDirEntries } from "./dir-utils";
import type { DirEntry } from "@/lib/filesystem-client";

function makeEntry(name: string, isDirectory: boolean): DirEntry {
  return {
    name,
    path: `/root/${name}`,
    isDirectory,
    isFile: !isDirectory,
  };
}

describe("sortDirEntries", () => {
  it("puts directories before files", () => {
    const entries = [
      makeEntry("app.ts", false),
      makeEntry("src", true),
      makeEntry("README.md", false),
      makeEntry("lib", true),
    ];
    const sorted = sortDirEntries(entries);
    expect(sorted.map((e) => e.name)).toEqual([
      "lib",
      "src",
      "app.ts",
      "README.md",
    ]);
  });

  it("sorts directories alphabetically (case-insensitive)", () => {
    const entries = [
      makeEntry("Zebra", true),
      makeEntry("alpha", true),
      makeEntry("Beta", true),
    ];
    const sorted = sortDirEntries(entries);
    expect(sorted.map((e) => e.name)).toEqual(["alpha", "Beta", "Zebra"]);
  });

  it("sorts files alphabetically (case-insensitive)", () => {
    const entries = [
      makeEntry("zoo.ts", false),
      makeEntry("App.tsx", false),
      makeEntry("main.ts", false),
    ];
    const sorted = sortDirEntries(entries);
    expect(sorted.map((e) => e.name)).toEqual(["App.tsx", "main.ts", "zoo.ts"]);
  });

  it("returns empty array for empty input", () => {
    expect(sortDirEntries([])).toEqual([]);
  });

  it("does not mutate the original array", () => {
    const entries = [makeEntry("b.ts", false), makeEntry("a.ts", false)];
    const original = [...entries];
    sortDirEntries(entries);
    expect(entries).toEqual(original);
  });

  it("handles single entry", () => {
    const entries = [makeEntry("only.ts", false)];
    const sorted = sortDirEntries(entries);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].name).toBe("only.ts");
  });
});
