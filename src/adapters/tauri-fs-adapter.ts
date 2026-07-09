import type { FSAdapter, DirEntry } from "../../core/services/fs-adapter";
import { FilesystemClient } from "@/lib/filesystem-client";

/**
 * Convert a simple glob pattern to a RegExp.
 *
 * Supports:
 *   - `*`  → match anything except path separators
 *   - `**` → match anything including path separators (recursive)
 *   - `?`  → match a single character
 *
 * This intentionally does NOT cover brace expansion or advanced glob
 * features — just the patterns needed for file discovery.
 *
 * All non-wildcard characters are treated literally: any regex
 * metacharacter (e.g. `.`, `+`, `(`, `)`, `[`, `]`, `{`, `}`, `^`, `$`,
 * `|`, `\`) is escaped so patterns like `a+b/*.ts` or `(x).js` are matched
 * as literal text instead of producing an invalid or unintended RegExp.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      // `**/` or trailing `**`
      re += ".*";
      i += 2;
      if (pattern[i] === "/") i++; // consume trailing slash
    } else if (ch === "*") {
      re += "[^/]*";
      i++;
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else {
      // Escape every regex metacharacter so the glob segment is matched
      // literally. `/` is not special in a RegExp body but is harmless to
      // leave unescaped; everything in this class needs a backslash.
      if (/[.+^${}()|[\]\\]/.test(ch)) {
        re += "\\" + ch;
      } else {
        re += ch;
      }
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Tauri/frontend implementation of FSAdapter.
 * Uses FilesystemClient directly for absolute path operations.
 *
 * IMPORTANT: This adapter works with ABSOLUTE paths (e.g., ~/.claude/skills).
 * It does NOT use the persistence module which prepends the data directory.
 */
export class TauriFSAdapter implements FSAdapter {
  private fsClient = new FilesystemClient();

  async exists(path: string): Promise<boolean> {
    return this.fsClient.exists(path);
  }

  async readFile(path: string): Promise<string> {
    return this.fsClient.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.fsClient.writeFile(path, content);
  }

  async readDir(path: string): Promise<string[]> {
    const entries = await this.fsClient.listDir(path);
    return entries.map((entry) => entry.name);
  }

  async glob(pattern: string, cwd: string): Promise<string[]> {
    const regex = globToRegExp(pattern);
    const results: string[] = [];

    const walk = async (dir: string, prefix: string): Promise<void> => {
      const entries = await this.fsClient.listDir(dir);
      for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isFile && regex.test(relative)) {
          results.push(relative);
        }
        if (entry.isDirectory) {
          await walk(this.fsClient.joinPath(dir, entry.name), relative);
        }
      }
    };

    await walk(cwd, "");
    return results;
  }

  async mkdir(path: string, _recursive?: boolean): Promise<void> {
    return this.fsClient.mkdir(path);
  }

  async listDirWithMetadata(path: string): Promise<DirEntry[]> {
    return this.fsClient.listDir(path);
  }

  joinPath(...segments: string[]): string {
    return this.fsClient.joinPath(...segments);
  }
}
