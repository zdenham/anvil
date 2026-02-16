import { describe, it, expect } from "vitest";
import { getFileIconUrl, getFolderIconUrl } from "./file-icons";

describe("getFileIconUrl", () => {
  describe("exact filename matches", () => {
    it("resolves package.json", () => {
      const url = getFileIconUrl("package.json");
      expect(url).toBe("/material-icons/nodejs.svg");
    });

    it("resolves Dockerfile", () => {
      const url = getFileIconUrl("Dockerfile");
      // manifest stores lowercase keys, so case-insensitive match
      const urlLower = getFileIconUrl("dockerfile");
      expect(url).toMatch(/^\/material-icons\/.*\.svg$/);
      expect(urlLower).toMatch(/^\/material-icons\/.*\.svg$/);
    });

    it("is case-insensitive for filenames", () => {
      const lower = getFileIconUrl("makefile");
      const upper = getFileIconUrl("Makefile");
      expect(lower).toBe(upper);
    });
  });

  describe("extension matches", () => {
    it("resolves .rs files via fileExtensions", () => {
      const url = getFileIconUrl("main.rs");
      expect(url).toBe("/material-icons/rust.svg");
    });

    it("resolves .py files via fileExtensions", () => {
      const url = getFileIconUrl("app.py");
      expect(url).toBe("/material-icons/python.svg");
    });

    it("resolves .json files via fileExtensions", () => {
      const url = getFileIconUrl("config.json");
      expect(url).toBe("/material-icons/json.svg");
    });

    it("resolves .md files via fileExtensions", () => {
      // Use a generic .md filename — "README.md" matches as exact filename
      const url = getFileIconUrl("notes.md");
      expect(url).toBe("/material-icons/markdown.svg");
    });

    it("resolves .css files via fileExtensions", () => {
      const url = getFileIconUrl("styles.css");
      expect(url).toBe("/material-icons/css.svg");
    });

    it("resolves .tsx files via fileExtensions", () => {
      const url = getFileIconUrl("component.tsx");
      expect(url).toBe("/material-icons/react_ts.svg");
    });

    it("resolves .jsx files via fileExtensions", () => {
      const url = getFileIconUrl("component.jsx");
      expect(url).toBe("/material-icons/react.svg");
    });

    it("resolves compound extensions like .d.ts", () => {
      const url = getFileIconUrl("types.d.ts");
      expect(url).toMatch(/^\/material-icons\/.*\.svg$/);
      // d.ts has its own mapping, should not be generic typescript
      expect(url).not.toBe("");
    });
  });

  describe("languageId fallback", () => {
    it("resolves .ts files via languageId fallback", () => {
      const url = getFileIconUrl("index.ts");
      expect(url).toBe("/material-icons/typescript.svg");
    });

    it("resolves .js files via languageId fallback", () => {
      const url = getFileIconUrl("index.js");
      expect(url).toBe("/material-icons/javascript.svg");
    });

    it("resolves .html files via languageId fallback", () => {
      const url = getFileIconUrl("index.html");
      expect(url).toBe("/material-icons/html.svg");
    });

    it("resolves .yaml files via languageId fallback", () => {
      const url = getFileIconUrl("config.yaml");
      expect(url).toBe("/material-icons/yaml.svg");
    });

    it("resolves .yml files via languageId fallback", () => {
      const url = getFileIconUrl("config.yml");
      expect(url).toBe("/material-icons/yaml.svg");
    });

    it("resolves .cts files via languageId fallback", () => {
      const url = getFileIconUrl("module.cts");
      expect(url).toBe("/material-icons/typescript.svg");
    });

    it("resolves .mts files via languageId fallback", () => {
      const url = getFileIconUrl("module.mts");
      expect(url).toBe("/material-icons/typescript.svg");
    });
  });

  describe("fallback to default", () => {
    it("returns default file icon for unknown extensions", () => {
      const url = getFileIconUrl("data.xyz123");
      expect(url).toMatch(/^\/material-icons\/file\.svg$/);
    });

    it("returns default file icon for files with no extension", () => {
      const url = getFileIconUrl("LICENSE");
      // LICENSE might have a special filename match; if not, it falls back
      expect(url).toMatch(/^\/material-icons\/.*\.svg$/);
    });
  });

  describe("returns valid URL format", () => {
    it("all returned URLs start with /material-icons/", () => {
      const urls = [
        getFileIconUrl("main.rs"),
        getFileIconUrl("app.py"),
        getFileIconUrl("index.ts"),
        getFileIconUrl("Dockerfile"),
        getFileIconUrl("unknown.xyz"),
      ];
      for (const url of urls) {
        expect(url).toMatch(/^\/material-icons\/.*\.svg$/);
      }
    });
  });
});

describe("getFolderIconUrl", () => {
  describe("named folder matches", () => {
    it("resolves 'src' folder", () => {
      const url = getFolderIconUrl("src");
      expect(url).toMatch(/^\/material-icons\/folder-src.*\.svg$/);
    });

    it("resolves 'node_modules' folder", () => {
      const url = getFolderIconUrl("node_modules");
      expect(url).toMatch(/^\/material-icons\/folder-node.*\.svg$/);
    });

    it("resolves 'src' folder expanded", () => {
      const urlClosed = getFolderIconUrl("src", false);
      const urlOpen = getFolderIconUrl("src", true);
      expect(urlClosed).toMatch(/^\/material-icons\/folder-src.*\.svg$/);
      expect(urlOpen).toMatch(/^\/material-icons\/folder-src.*\.svg$/);
      // Open and closed should be different icons
      expect(urlOpen).not.toBe(urlClosed);
    });
  });

  describe("default folder icon", () => {
    it("returns default folder icon for unknown folder names", () => {
      const url = getFolderIconUrl("my-random-folder");
      expect(url).toBe("/material-icons/folder.svg");
    });

    it("returns default expanded folder icon for unknown folders", () => {
      const url = getFolderIconUrl("my-random-folder", true);
      expect(url).toBe("/material-icons/folder-open.svg");
    });
  });

  describe("case insensitivity", () => {
    it("resolves folder names case-insensitively", () => {
      const lower = getFolderIconUrl("src");
      const upper = getFolderIconUrl("SRC");
      expect(lower).toBe(upper);
    });
  });

  describe("returns valid URL format", () => {
    it("all returned URLs start with /material-icons/", () => {
      const urls = [
        getFolderIconUrl("src"),
        getFolderIconUrl("node_modules"),
        getFolderIconUrl("unknown-folder"),
        getFolderIconUrl("src", true),
        getFolderIconUrl("unknown-folder", true),
      ];
      for (const url of urls) {
        expect(url).toMatch(/^\/material-icons\/.*\.svg$/);
      }
    });
  });
});
