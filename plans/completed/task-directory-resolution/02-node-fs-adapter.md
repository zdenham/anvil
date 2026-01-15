# 02: Node.js Filesystem Adapter

**Group:** B (Parallel with 03, 04)
**Dependencies:** 01-types-and-interface
**Blocks:** 05-migrate-slug-apis

---

## Goal

Implement the FSAdapter interface for Node.js environment (used by agents).

---

## File to Create

### `agents/src/adapters/node-fs-adapter.ts`

```typescript
import { FSAdapter } from "../../../core/services/fs-adapter";
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
```

---

## Notes

- Uses sync versions wrapped in async for simplicity (agents are single-threaded)
- The `glob` package is already a dependency in agents
- Consider adding error handling wrappers if needed

---

## Verification

- [ ] File created at `agents/src/adapters/node-fs-adapter.ts`
- [ ] Implements all 6 methods from FSAdapter interface
- [ ] TypeScript compiles without errors
- [ ] Unit test: each method works correctly
