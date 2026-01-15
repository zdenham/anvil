# Adapters Pattern

Share business logic between Tauri frontend and Node.js agents by injecting platform-specific adapters.

## Problem

The `core/` package contains business logic (services) that must run in two different environments:
- **Tauri frontend**: Uses Tauri's IPC-based filesystem and shell commands
- **Node.js agents**: Uses Node's `fs` module and `child_process`

Duplicating business logic for each platform creates maintenance burden and bugs.

## Solution

Define adapter interfaces in `core/`, then inject platform-specific implementations:

```
core/adapters/types.ts      <- Interfaces (FileSystemAdapter, GitAdapter, etc.)
core/adapters/node/         <- Node.js implementations
src/adapters/               <- Tauri implementations
```

Services accept adapters via constructor injection, making them platform-agnostic.

## When to Use

Use adapters when a service needs:
- Filesystem operations (read/write/glob)
- Git commands
- File locking
- Any OS-level operation that differs between platforms

## Implementation

### 1. Define the Interface (core/adapters/types.ts)

```typescript
export interface FileSystemAdapter {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  mkdir(path: string, options?: { recursive?: boolean }): void;
  exists(path: string): boolean;
  remove(path: string): void;
  readDir(path: string): string[];
  glob(pattern: string, cwd: string): string[];
}
```

### 2. Create Node Implementation (core/adapters/node/fs-adapter.ts)

```typescript
import * as fs from 'fs';
import { globSync } from 'glob';
import type { FileSystemAdapter } from '../types';

export class NodeFileSystemAdapter implements FileSystemAdapter {
  readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
  }

  writeFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  // ... other methods
}
```

### 3. Create Tauri Implementation (src/adapters/tauri-fs-adapter.ts)

```typescript
import type { FSAdapter } from "@core/services/fs-adapter";
import { persistence } from "@/lib/persistence";

export class TauriFSAdapter implements FSAdapter {
  async exists(path: string): Promise<boolean> {
    return persistence.exists(path);
  }

  async readFile(path: string): Promise<string> {
    const content = await persistence.readText(path);
    if (content === null) throw new Error(`File not found: ${path}`);
    return content;
  }
  // ... other methods wrap Tauri's persistence layer
}
```

### 4. Inject into Services

```typescript
// Service accepts adapter via constructor
export class ThreadService {
  constructor(
    private mortDir: string,
    private fs: FileSystemAdapter  // <-- injected
  ) {}

  create(taskSlug: string, input: CreateThreadInput): ThreadMetadata {
    this.fs.mkdir(threadDir, { recursive: true });
    this.fs.writeFile(metadataPath, JSON.stringify(metadata));
    return metadata;
  }
}
```

### 5. Wire Up at Runtime

```typescript
// In Node.js (agents/src/orchestration.ts)
const fs = new NodeFileSystemAdapter();
const git = new NodeGitAdapter();
const threadService = new ThreadService(mortDir, fs);

// In Tauri (frontend)
const fs = new TauriFSAdapter();
const resolutionService = new ResolutionService(fs, tasksDir);
```

## Do

- **Define narrow interfaces**: Only include methods the services actually need
- **Use constructor injection**: Makes dependencies explicit and testable
- **Keep adapters thin**: They should only translate platform calls, not contain logic
- **Mock adapters in tests**: Create simple mock implementations for unit tests

```typescript
// Good: Mock adapter for testing
const mockFs: FileSystemAdapter = {
  readFile: vi.fn((path) => mockStorage.get(path) ?? throwNotFound(path)),
  writeFile: vi.fn((path, content) => mockStorage.set(path, content)),
  exists: vi.fn((path) => mockStorage.has(path)),
  // ...
};
const service = new ThreadService(mortDir, mockFs);
```

## Don't

- **Don't put business logic in adapters**: They're just translation layers
- **Don't access platform APIs directly in services**: Always go through adapters
- **Don't create global adapter singletons**: Inject them for testability
- **Don't mix sync/async carelessly**: Pick one style per adapter interface

```typescript
// Bad: Service directly uses Node APIs
export class ThreadService {
  create() {
    fs.mkdirSync(dir);  // Tied to Node.js!
  }
}

// Bad: Global singleton
const globalFs = new NodeFileSystemAdapter();
export class ThreadService {
  private fs = globalFs;  // Can't mock in tests!
}
```

## Existing Adapters

| Interface | Node Implementation | Tauri Implementation |
|-----------|--------------------|--------------------|
| `FileSystemAdapter` | `NodeFileSystemAdapter` | `TauriFSAdapter` |
| `GitAdapter` | `NodeGitAdapter` | (via Tauri commands) |
| `PathLock` | `NodePathLock` | N/A |
| `FSAdapter` (async) | `NodeFSAdapter` | `TauriFSAdapter` |

## See Also

- `core/adapters/types.ts` - All adapter interfaces
- `core/adapters/async-wrapper.ts` - Converts sync adapters to async interface
- `agents/src/orchestration.ts` - Example of wiring up Node adapters
