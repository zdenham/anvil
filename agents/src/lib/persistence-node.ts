import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  statSync,
  rmSync,
  renameSync,
} from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { AnvilPersistence } from "../core/persistence.js";
import { logger } from "./logger.js";

/**
 * Node.js filesystem implementation of AnvilPersistence.
 * Used by the CLI and agent runner.
 */
export class NodePersistence extends AnvilPersistence {
  private anvilDir: string;

  constructor(anvilDir?: string) {
    super();
    // Priority: constructor arg > ANVIL_DATA_DIR env var > default ~/.anvil
    this.anvilDir = anvilDir ?? process.env.ANVIL_DATA_DIR ?? join(homedir(), ".anvil");
    if (!anvilDir && !process.env.ANVIL_DATA_DIR) {
      logger.warn("[NodePersistence] No anvilDir or ANVIL_DATA_DIR provided, falling back to ~/.anvil");
    }
  }

  private resolvePath(path: string): string {
    return join(this.anvilDir, path);
  }

  async read<T>(path: string): Promise<T | null> {
    const fullPath = this.resolvePath(path);
    if (!existsSync(fullPath)) return null;
    try {
      const content = readFileSync(fullPath, "utf-8");
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  async write(path: string, data: unknown): Promise<void> {
    const fullPath = this.resolvePath(path);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, JSON.stringify(data, null, 2));
  }

  async delete(path: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }
  }

  async list(dir: string): Promise<string[]> {
    const fullPath = this.resolvePath(dir);
    if (!existsSync(fullPath)) return [];
    return readdirSync(fullPath);
  }

  async listDirs(dir: string): Promise<string[]> {
    const fullPath = this.resolvePath(dir);
    if (!existsSync(fullPath)) return [];
    return readdirSync(fullPath).filter((name) => {
      const stat = statSync(join(fullPath, name));
      return stat.isDirectory();
    });
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(this.resolvePath(path));
  }

  async mkdir(path: string): Promise<void> {
    mkdirSync(this.resolvePath(path), { recursive: true });
  }

  async rmdir(path: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    if (existsSync(fullPath)) {
      rmSync(fullPath, { recursive: true });
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content);
  }

  async readText(path: string): Promise<string | null> {
    const fullPath = this.resolvePath(path);
    if (!existsSync(fullPath)) return null;
    return readFileSync(fullPath, "utf-8");
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const fullOldPath = this.resolvePath(oldPath);
    const fullNewPath = this.resolvePath(newPath);
    renameSync(fullOldPath, fullNewPath);
  }
}
