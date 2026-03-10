import { describe, it, expect } from "vitest";
import { extractImagePaths, stripImagePaths } from "../image-paths";

describe("extractImagePaths", () => {
  it("extracts absolute image paths", () => {
    const content = "/Users/me/photo.png\nsome text\n/tmp/screenshot.jpg";
    expect(extractImagePaths(content)).toEqual([
      "/Users/me/photo.png",
      "/tmp/screenshot.jpg",
    ]);
  });

  it("handles svg files", () => {
    expect(extractImagePaths("/icons/logo.svg")).toEqual(["/icons/logo.svg"]);
  });

  it("ignores non-image paths", () => {
    const content = "/Users/me/readme.md\n/tmp/data.json\n/src/index.ts";
    expect(extractImagePaths(content)).toEqual([]);
  });

  it("ignores relative paths", () => {
    expect(extractImagePaths("photo.png\n./image.jpg")).toEqual([]);
  });

  it("handles empty content", () => {
    expect(extractImagePaths("")).toEqual([]);
  });

  it("handles whitespace-padded lines", () => {
    expect(extractImagePaths("  /tmp/photo.png  ")).toEqual(["/tmp/photo.png"]);
  });

  it("handles mixed content", () => {
    const content = "Check this image\n/tmp/cat.gif\nPretty cool right?\n/tmp/dog.webp";
    expect(extractImagePaths(content)).toEqual(["/tmp/cat.gif", "/tmp/dog.webp"]);
  });

  it("extracts image path with trailing text on same line", () => {
    expect(extractImagePaths("/Users/zac/Desktop/Screenshot 2026-03-09 at 2.28.08 PM.png hey")).toEqual([
      "/Users/zac/Desktop/Screenshot 2026-03-09 at 2.28.08 PM.png",
    ]);
  });

  it("extracts image path with leading text on same line", () => {
    expect(extractImagePaths("check this /tmp/photo.png")).toEqual(["/tmp/photo.png"]);
  });

  it("extracts image path surrounded by text", () => {
    expect(extractImagePaths("before /tmp/photo.png after")).toEqual(["/tmp/photo.png"]);
  });

  it("does not match image path with text appended without space", () => {
    expect(extractImagePaths("/Users/me/photo.pnghello")).toEqual([]);
  });

  it("does not match path embedded in a word", () => {
    expect(extractImagePaths("word/Users/me/photo.png")).toEqual([]);
  });
});

describe("stripImagePaths", () => {
  it("removes image path lines and trims", () => {
    const content = "/tmp/photo.png\nhello world";
    expect(stripImagePaths(content)).toBe("hello world");
  });

  it("returns empty string for image-only content", () => {
    expect(stripImagePaths("/tmp/a.png\n/tmp/b.jpg")).toBe("");
  });

  it("preserves non-image content", () => {
    const content = "line 1\nline 2\n/tmp/data.json";
    expect(stripImagePaths(content)).toBe("line 1\nline 2\n/tmp/data.json");
  });

  it("handles empty content", () => {
    expect(stripImagePaths("")).toBe("");
  });

  it("strips image paths from mixed content", () => {
    const content = "Check this\n/tmp/cat.png\nCool!";
    expect(stripImagePaths(content)).toBe("Check this\nCool!");
  });

  it("strips inline image path and keeps surrounding text", () => {
    expect(stripImagePaths("/tmp/photo.png hey there")).toBe("hey there");
  });

  it("strips inline image path from middle of text", () => {
    expect(stripImagePaths("before /tmp/photo.png after")).toBe("before after");
  });
});
