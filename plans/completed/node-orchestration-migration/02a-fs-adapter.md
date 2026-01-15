# Phase 2a: Node Filesystem Adapter

## Goal

Implement the FileSystemAdapter interface for Node.js using synchronous fs operations.

## Prerequisites

- [01-adapter-interfaces.md](./01-adapter-interfaces.md) complete

## Parallel With

- [02b-git-adapter.md](./02b-git-adapter.md)
- [02c-path-lock.md](./02c-path-lock.md)

## Files to Create

- `core/adapters/node/fs-adapter.ts`
- `core/adapters/node/fs-adapter.test.ts`

## Implementation

```typescript
// core/adapters/node/fs-adapter.ts
import * as fs from 'fs';
import * as path from 'path';
import type { FileSystemAdapter } from '../types';

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
}
```

## Tasks

1. Create `core/adapters/node/` directory
2. Implement `NodeFileSystemAdapter` class
3. Use sync methods: `readFileSync`, `writeFileSync`, `mkdirSync`, `existsSync`, `rmSync`, `readdirSync`
4. Write unit tests using temp directories

## Test Cases

- Read/write file round-trip
- Create nested directories with `recursive: true`
- Check exists for file, directory, non-existent
- Remove file and directory
- List directory contents

## Verification

- [ ] All tests pass
- [ ] Class implements FileSystemAdapter interface
- [ ] No async/await used
