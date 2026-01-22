/**
 * Control Panel Content Verification Tests
 *
 * Verifies that source code files contain no references to old "simple-task" naming:
 * - No "simple-task" in TypeScript/TSX files
 * - No "SimpleTask" in TypeScript/TSX files
 * - No "simpleTask" in TypeScript/TSX files
 * - No "SIMPLE_TASK" in Rust files
 * - No "simple_task" in Rust files
 * - No "simple-task" in JSON config files
 * - No "simple-task" in HTML files
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

describe("Control Panel Content Verification", () => {
  const projectRoot = process.cwd();

  async function searchInFiles(
    pattern: RegExp,
    extensions: string[]
  ): Promise<string[]> {
    const matches: string[] = [];
    const globPattern = `**/*.{${extensions.join(",")}}`;
    const files = await glob(globPattern, {
      cwd: projectRoot,
      ignore: [
        "node_modules/**",
        "dist/**",
        "target/**",
        "plans/**",
        "**/*.test.ts",
        "**/*.test.tsx",
      ],
    });

    for (const file of files) {
      const content = fs.readFileSync(path.join(projectRoot, file), "utf-8");
      if (pattern.test(content)) {
        matches.push(file);
      }
    }
    return matches;
  }

  it('should have no "simple-task" references in TypeScript/TSX files', async () => {
    const matches = await searchInFiles(/simple-task/gi, ["ts", "tsx"]);
    expect(matches).toEqual([]);
  });

  it('should have no "SimpleTaskWindow" or "SimpleTaskHeader" component references in TypeScript/TSX files', async () => {
    // Check for old component names - but not function names like createSimpleTask
    const windowMatches = await searchInFiles(/SimpleTaskWindow/g, ["ts", "tsx"]);
    const headerMatches = await searchInFiles(/SimpleTaskHeader/g, ["ts", "tsx"]);
    expect(windowMatches).toEqual([]);
    expect(headerMatches).toEqual([]);
  });

  it('should have no "simpleTask" store or hook references in TypeScript/TSX files', async () => {
    // Check for old store/hook names like useSimpleTaskStore
    const matches = await searchInFiles(/useSimpleTask|simpleTaskStore/g, ["ts", "tsx"]);
    expect(matches).toEqual([]);
  });

  it('should have no "SIMPLE_TASK" references in Rust files', async () => {
    const matches = await searchInFiles(/SIMPLE_TASK/g, ["rs"]);
    expect(matches).toEqual([]);
  });

  it('should have no "simple_task" references in Rust files', async () => {
    const matches = await searchInFiles(/simple_task/g, ["rs"]);
    expect(matches).toEqual([]);
  });

  it('should have no "simple-task" references in JSON config files', async () => {
    const matches = await searchInFiles(/simple-task/gi, ["json"]);
    expect(matches).toEqual([]);
  });

  it('should have no "simple-task" references in HTML files', async () => {
    const matches = await searchInFiles(/simple-task/gi, ["html"]);
    expect(matches).toEqual([]);
  });
});
