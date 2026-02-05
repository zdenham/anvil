/**
 * File system utilities for migrations.
 * No Tauri dependencies - pure Node.js.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Read and parse a JSON file.
 */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write a JSON file with pretty printing.
 */
export function writeJsonFile<T>(filePath: string, data: T): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Ensure a directory exists.
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Check if a path exists.
 */
export function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Copy a file.
 */
export function copyFile(src: string, dest: string): void {
  const dir = path.dirname(dest);
  ensureDir(dir);
  fs.copyFileSync(src, dest);
}

/**
 * Copy a directory recursively, excluding specified directories.
 */
export function copyDirExcluding(
  src: string,
  dest: string,
  exclude: string[] = []
): void {
  ensureDir(dest);

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirExcluding(srcPath, destPath, exclude);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

/**
 * Join path segments.
 */
export function joinPath(...segments: string[]): string {
  return path.join(...segments);
}
