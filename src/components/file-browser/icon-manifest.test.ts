// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  manifest,
  resolveIconPath,
  defaultFileIconPath,
  defaultFolderIconPath,
  defaultFolderExpandedIconPath,
} from "./icon-manifest";

describe("icon-manifest", () => {
  describe("manifest", () => {
    it("has file extensions mapping", () => {
      expect(manifest.fileExtensions).toBeDefined();
      expect(Object.keys(manifest.fileExtensions ?? {}).length).toBeGreaterThan(
        100
      );
    });

    it("has file names mapping", () => {
      expect(manifest.fileNames).toBeDefined();
      expect(Object.keys(manifest.fileNames ?? {}).length).toBeGreaterThan(50);
    });

    it("has folder names mapping", () => {
      expect(manifest.folderNames).toBeDefined();
      expect(Object.keys(manifest.folderNames ?? {}).length).toBeGreaterThan(
        50
      );
    });

    it("has icon definitions", () => {
      expect(manifest.iconDefinitions).toBeDefined();
      expect(
        Object.keys(manifest.iconDefinitions ?? {}).length
      ).toBeGreaterThan(100);
    });

    it("has language IDs mapping", () => {
      expect(manifest.languageIds).toBeDefined();
      expect(manifest.languageIds?.typescript).toBe("typescript");
      expect(manifest.languageIds?.javascript).toBe("javascript");
    });
  });

  describe("resolveIconPath", () => {
    it("resolves a known icon ID to a module path", () => {
      const path = resolveIconPath("typescript");
      expect(path).toBe("material-icon-theme/icons/typescript.svg");
    });

    it("resolves the default file icon", () => {
      const path = resolveIconPath("file");
      expect(path).toBe("material-icon-theme/icons/file.svg");
    });

    it("resolves the default folder icon", () => {
      const path = resolveIconPath("folder");
      expect(path).toBe("material-icon-theme/icons/folder.svg");
    });

    it("returns empty string for unknown icon ID", () => {
      const path = resolveIconPath("nonexistent-icon-id-xyz");
      expect(path).toBe("");
    });

    it("returns empty string for empty icon ID", () => {
      const path = resolveIconPath("");
      expect(path).toBe("");
    });
  });

  describe("default icon paths", () => {
    it("has a default file icon path", () => {
      expect(defaultFileIconPath).toMatch(
        /^material-icon-theme\/icons\/.*\.svg$/
      );
    });

    it("has a default folder icon path", () => {
      expect(defaultFolderIconPath).toMatch(
        /^material-icon-theme\/icons\/.*\.svg$/
      );
    });

    it("has a default folder expanded icon path", () => {
      expect(defaultFolderExpandedIconPath).toMatch(
        /^material-icon-theme\/icons\/.*\.svg$/
      );
    });
  });
});
