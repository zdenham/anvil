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
});
