import * as fs from 'fs';
import { globSync } from 'glob';
import type { FileSystemAdapter } from '../types';

/**
 * Node.js implementation of the FileSystemAdapter interface.
 * Uses synchronous fs operations for simpler control flow.
 */
export class NodeFileSystemAdapter implements FileSystemAdapter {
  readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
  }

  writeFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  mkdir(dirPath: string, options?: { recursive?: boolean }): void {
    fs.mkdirSync(dirPath, options);
  }

  exists(targetPath: string): boolean {
    return fs.existsSync(targetPath);
  }

  remove(targetPath: string): void {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  readDir(dirPath: string): string[] {
    return fs.readdirSync(dirPath);
  }

  glob(pattern: string, cwd: string): string[] {
    return globSync(pattern, { cwd });
  }
}
