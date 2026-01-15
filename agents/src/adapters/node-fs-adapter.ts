import type { FSAdapter } from "@core/services/fs-adapter.js";
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { glob } from "glob";

export class NodeFSAdapter implements FSAdapter {
  async exists(path: string): Promise<boolean> {
    return existsSync(path);
  }

  async readFile(path: string): Promise<string> {
    return readFileSync(path, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    writeFileSync(path, content);
  }

  async readDir(path: string): Promise<string[]> {
    return readdirSync(path);
  }

  async glob(pattern: string, cwd: string): Promise<string[]> {
    return glob(pattern, { cwd });
  }

  async mkdir(path: string, recursive = true): Promise<void> {
    mkdirSync(path, { recursive });
  }
}
