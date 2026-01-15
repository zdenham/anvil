# 03: Tauri Filesystem Adapter

**Group:** B (Parallel with 02, 04)
**Dependencies:** 01-types-and-interface
**Blocks:** 05-migrate-slug-apis

---

## Goal

Implement the FSAdapter interface for Tauri/frontend environment.

---

## File to Create

### `src/adapters/tauri-fs-adapter.ts`

```typescript
import { FSAdapter } from "../../core/services/fs-adapter";
import { persistence } from "@/lib/persistence";

export class TauriFSAdapter implements FSAdapter {
  async exists(path: string): Promise<boolean> {
    return persistence.exists(path);
  }

  async readFile(path: string): Promise<string> {
    return persistence.readText(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    return persistence.writeText(path, content);
  }

  async readDir(path: string): Promise<string[]> {
    const entries = await persistence.listDirEntries(path);
    return entries.map(x => x.name);
  }

  async glob(pattern: string, cwd: string): Promise<string[]> {
    return persistence.glob(pattern, cwd);
  }

  async mkdir(path: string): Promise<void> {
    return persistence.createDir(path);
  }
}
```

---

## Pre-requisites to Verify

Before implementation, confirm these `persistence` methods exist:

| Method | Expected Signature |
|--------|-------------------|
| `exists` | `(path: string) => Promise<boolean>` |
| `readText` | `(path: string) => Promise<string>` |
| `writeText` | `(path: string, content: string) => Promise<void>` |
| `listDirEntries` | `(path: string) => Promise<{name: string, ...}[]>` |
| `glob` | `(pattern: string, cwd: string) => Promise<string[]>` |
| `createDir` | `(path: string) => Promise<void>` |

If `persistence.glob` doesn't exist, check `src/lib/persistence.ts` for alternatives.

---

## Verification

- [ ] File created at `src/adapters/tauri-fs-adapter.ts`
- [ ] All persistence methods exist and match expected signatures
- [ ] Implements all 6 methods from FSAdapter interface
- [ ] TypeScript compiles without errors
