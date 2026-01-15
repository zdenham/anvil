import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NodeFileSystemAdapter } from './fs-adapter';

describe('NodeFileSystemAdapter', () => {
  let adapter: NodeFileSystemAdapter;
  let tempDir: string;

  beforeEach(() => {
    adapter = new NodeFileSystemAdapter();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readFile / writeFile', () => {
    it('should round-trip file content', () => {
      const filePath = path.join(tempDir, 'test.txt');
      const content = 'Hello, World!';

      adapter.writeFile(filePath, content);
      const result = adapter.readFile(filePath);

      expect(result).toBe(content);
    });

    it('should handle UTF-8 content', () => {
      const filePath = path.join(tempDir, 'utf8.txt');
      const content = 'Hello, World!';

      adapter.writeFile(filePath, content);
      const result = adapter.readFile(filePath);

      expect(result).toBe(content);
    });

    it('should overwrite existing file', () => {
      const filePath = path.join(tempDir, 'overwrite.txt');

      adapter.writeFile(filePath, 'initial');
      adapter.writeFile(filePath, 'updated');
      const result = adapter.readFile(filePath);

      expect(result).toBe('updated');
    });

    it('should throw when reading non-existent file', () => {
      const filePath = path.join(tempDir, 'nonexistent.txt');

      expect(() => adapter.readFile(filePath)).toThrow();
    });
  });

  describe('mkdir', () => {
    it('should create a directory', () => {
      const dirPath = path.join(tempDir, 'new-dir');

      adapter.mkdir(dirPath);

      expect(fs.existsSync(dirPath)).toBe(true);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    it('should create nested directories with recursive: true', () => {
      const dirPath = path.join(tempDir, 'a', 'b', 'c');

      adapter.mkdir(dirPath, { recursive: true });

      expect(fs.existsSync(dirPath)).toBe(true);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    it('should throw when creating nested dirs without recursive flag', () => {
      const dirPath = path.join(tempDir, 'x', 'y', 'z');

      expect(() => adapter.mkdir(dirPath)).toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing file', () => {
      const filePath = path.join(tempDir, 'exists.txt');
      fs.writeFileSync(filePath, 'content');

      expect(adapter.exists(filePath)).toBe(true);
    });

    it('should return true for existing directory', () => {
      const dirPath = path.join(tempDir, 'exists-dir');
      fs.mkdirSync(dirPath);

      expect(adapter.exists(dirPath)).toBe(true);
    });

    it('should return false for non-existent path', () => {
      const fakePath = path.join(tempDir, 'does-not-exist');

      expect(adapter.exists(fakePath)).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove a file', () => {
      const filePath = path.join(tempDir, 'to-remove.txt');
      fs.writeFileSync(filePath, 'content');

      adapter.remove(filePath);

      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should remove a directory recursively', () => {
      const dirPath = path.join(tempDir, 'to-remove-dir');
      const nestedFile = path.join(dirPath, 'nested', 'file.txt');
      fs.mkdirSync(path.join(dirPath, 'nested'), { recursive: true });
      fs.writeFileSync(nestedFile, 'content');

      adapter.remove(dirPath);

      expect(fs.existsSync(dirPath)).toBe(false);
    });

    it('should not throw when removing non-existent path', () => {
      const fakePath = path.join(tempDir, 'already-gone');

      expect(() => adapter.remove(fakePath)).not.toThrow();
    });
  });

  describe('readDir', () => {
    it('should list directory contents', () => {
      const dir = path.join(tempDir, 'list-dir');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'file1.txt'), 'a');
      fs.writeFileSync(path.join(dir, 'file2.txt'), 'b');
      fs.mkdirSync(path.join(dir, 'subdir'));

      const result = adapter.readDir(dir);

      expect(result.sort()).toEqual(['file1.txt', 'file2.txt', 'subdir'].sort());
    });

    it('should return empty array for empty directory', () => {
      const dir = path.join(tempDir, 'empty-dir');
      fs.mkdirSync(dir);

      const result = adapter.readDir(dir);

      expect(result).toEqual([]);
    });

    it('should throw when reading non-existent directory', () => {
      const fakePath = path.join(tempDir, 'fake-dir');

      expect(() => adapter.readDir(fakePath)).toThrow();
    });
  });

  describe('glob', () => {
    it('should find files matching glob pattern', () => {
      const dir = path.join(tempDir, 'glob-test');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'file1.json'), '{}');
      fs.writeFileSync(path.join(dir, 'file2.json'), '{}');
      fs.writeFileSync(path.join(dir, 'file3.txt'), 'text');

      const result = adapter.glob('*.json', dir);

      expect(result.sort()).toEqual(['file1.json', 'file2.json'].sort());
    });

    it('should find files in nested directories', () => {
      const dir = path.join(tempDir, 'glob-nested');
      fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'root.json'), '{}');
      fs.writeFileSync(path.join(dir, 'a', 'nested.json'), '{}');
      fs.writeFileSync(path.join(dir, 'a', 'b', 'deep.json'), '{}');

      const result = adapter.glob('**/*.json', dir);

      expect(result.sort()).toEqual([
        'a/b/deep.json',
        'a/nested.json',
        'root.json',
      ].sort());
    });

    it('should return empty array when no matches found', () => {
      const dir = path.join(tempDir, 'glob-empty');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'file.txt'), 'text');

      const result = adapter.glob('*.json', dir);

      expect(result).toEqual([]);
    });
  });
});
