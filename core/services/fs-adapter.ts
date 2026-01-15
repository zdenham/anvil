/**
 * Platform-agnostic filesystem adapter.
 * Implementations: NodeFSAdapter (agents), TauriFSAdapter (frontend)
 */
export interface FSAdapter {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  glob(pattern: string, cwd: string): Promise<string[]>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
}
