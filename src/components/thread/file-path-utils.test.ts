import { describe, it, expect } from "vitest";
import { looksLikeFilePath, resolvePath, autoLinkFilePaths } from "./file-path-utils";

describe("looksLikeFilePath", () => {
  it("recognizes common source file paths", () => {
    expect(looksLikeFilePath("README.md")).toBe(true);
    expect(looksLikeFilePath("src/components/foo.tsx")).toBe(true);
    expect(looksLikeFilePath("package.json")).toBe(true);
    expect(looksLikeFilePath("tsconfig.json")).toBe(true);
    expect(looksLikeFilePath("lib/utils.ts")).toBe(true);
  });

  it("recognizes relative paths", () => {
    expect(looksLikeFilePath("./README.md")).toBe(true);
    expect(looksLikeFilePath("../lib/utils.ts")).toBe(true);
    expect(looksLikeFilePath("./foo")).toBe(true);
    expect(looksLikeFilePath("../bar")).toBe(true);
  });

  it("recognizes various file extensions", () => {
    expect(looksLikeFilePath("main.rs")).toBe(true);
    expect(looksLikeFilePath("app.py")).toBe(true);
    expect(looksLikeFilePath("style.css")).toBe(true);
    expect(looksLikeFilePath("index.html")).toBe(true);
    expect(looksLikeFilePath("Cargo.lock")).toBe(true);
    expect(looksLikeFilePath("config.yaml")).toBe(true);
    expect(looksLikeFilePath("script.sh")).toBe(true);
  });

  it("rejects URLs", () => {
    expect(looksLikeFilePath("http://example.com")).toBe(false);
    expect(looksLikeFilePath("https://github.com/foo/bar")).toBe(false);
    expect(looksLikeFilePath("ftp://files.example.com")).toBe(false);
  });

  it("rejects anchors", () => {
    expect(looksLikeFilePath("#section")).toBe(false);
    expect(looksLikeFilePath("#heading-1")).toBe(false);
  });

  it("rejects unrecognized extensions", () => {
    expect(looksLikeFilePath("v2.0")).toBe(false);
    expect(looksLikeFilePath("google.com")).toBe(false);
    expect(looksLikeFilePath("e.g")).toBe(false);
  });

  it("rejects common code identifiers", () => {
    expect(looksLikeFilePath("console.log")).toBe(false);
    expect(looksLikeFilePath("Object.keys")).toBe(false);
    expect(looksLikeFilePath("Array.from")).toBe(false);
    expect(looksLikeFilePath("process.env")).toBe(false);
    expect(looksLikeFilePath("Math.floor")).toBe(false);
  });
});

describe("resolvePath", () => {
  it("resolves relative paths against working directory", () => {
    expect(resolvePath("README.md", "/home/user/project")).toBe("/home/user/project/README.md");
    expect(resolvePath("src/foo.ts", "/home/user/project")).toBe("/home/user/project/src/foo.ts");
  });

  it("resolves ./ paths", () => {
    expect(resolvePath("./README.md", "/home/user/project")).toBe("/home/user/project/README.md");
  });

  it("resolves ../ paths", () => {
    expect(resolvePath("../lib/utils.ts", "/home/user/project")).toBe("/home/user/lib/utils.ts");
  });

  it("leaves absolute paths unchanged", () => {
    expect(resolvePath("/absolute/path/file.ts", "/home/user/project")).toBe("/absolute/path/file.ts");
  });
});

describe("autoLinkFilePaths", () => {
  it("links bare file paths in plain text", () => {
    const input = "The relative path of the README is README.md.";
    const output = autoLinkFilePaths(input);
    // README.md should be wrapped, but trailing period is not part of path
    expect(output).toContain("[README.md](README.md)");
  });

  it("links file paths with directory separators", () => {
    const input = "Found: src/components/thread/thinking-block.tsx";
    const output = autoLinkFilePaths(input);
    expect(output).toContain("[src/components/thread/thinking-block.tsx](src/components/thread/thinking-block.tsx)");
  });

  it("handles multiple file paths in a single line", () => {
    const input = "See README.md and package.json for details.";
    const output = autoLinkFilePaths(input);
    expect(output).toContain("[README.md](README.md)");
    expect(output).toContain("[package.json](package.json)");
  });

  it("does not link paths inside inline code", () => {
    const input = "Use `README.md` for documentation.";
    const output = autoLinkFilePaths(input);
    expect(output).toBe(input); // Should be unchanged
  });

  it("does not link paths inside existing markdown links", () => {
    const input = "See [the readme](README.md) for details.";
    const output = autoLinkFilePaths(input);
    expect(output).toBe(input); // Should be unchanged
  });

  it("does not link paths inside fenced code blocks", () => {
    const input = `Here is code:

\`\`\`
README.md
src/foo.ts
\`\`\`

After code.`;
    const output = autoLinkFilePaths(input);
    // Lines inside code block should be unchanged
    expect(output).toContain("```\nREADME.md\nsrc/foo.ts\n```");
  });

  it("does not link URLs", () => {
    const input = "Visit https://github.com/foo/bar.git for the repo.";
    const output = autoLinkFilePaths(input);
    expect(output).not.toContain("[https://");
  });

  it("handles the exact example from the bug report", () => {
    const input = `The relative path of the README is README.md.

Let me find a TSX file for you.
Found 100 files
Here's a random one: src/components/thread/thinking-block.tsx`;

    const output = autoLinkFilePaths(input);
    expect(output).toContain("[README.md](README.md)");
    expect(output).toContain("[src/components/thread/thinking-block.tsx](src/components/thread/thinking-block.tsx)");
  });

  it("does not double-link already-linked paths", () => {
    const input = "See [README.md](README.md) for details.";
    const output = autoLinkFilePaths(input);
    expect(output).toBe(input);
  });

  it("handles paths at the start of a line", () => {
    const input = "README.md contains the docs.";
    const output = autoLinkFilePaths(input);
    expect(output).toContain("[README.md](README.md)");
  });

  it("handles paths at the end of a line", () => {
    const input = "The config file is tsconfig.json";
    const output = autoLinkFilePaths(input);
    expect(output).toContain("[tsconfig.json](tsconfig.json)");
  });
});
