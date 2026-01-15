import type { FSAdapter } from "../../core/services/fs-adapter";
import { persistence } from "@/lib/persistence";

/**
 * Tauri/frontend implementation of FSAdapter.
 * Wraps the persistence module which operates on the data directory.
 */
export class TauriFSAdapter implements FSAdapter {
  async exists(path: string): Promise<boolean> {
    return persistence.exists(path);
  }

  async readFile(path: string): Promise<string> {
    const content = await persistence.readText(path);
    if (content === null) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    return persistence.writeText(path, content);
  }

  async readDir(path: string): Promise<string[]> {
    const entries = await persistence.listDirEntries(path);
    return entries.map((entry) => entry.name);
  }

  async glob(pattern: string, cwd: string): Promise<string[]> {
    // persistence.glob operates from the data directory root,
    // so we prefix the pattern with the cwd path
    const fullPattern = cwd ? `${cwd}/${pattern}` : pattern;
    const results = await persistence.glob(fullPattern);
    // Return paths relative to cwd by stripping the cwd prefix
    if (cwd) {
      const prefix = `${cwd}/`;
      return results.map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p));
    }
    return results;
  }

  async mkdir(path: string, _recursive?: boolean): Promise<void> {
    // ensureDir always creates recursively
    return persistence.ensureDir(path);
  }
}
