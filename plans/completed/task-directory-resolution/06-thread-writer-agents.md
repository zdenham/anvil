# 06: ThreadWriter Integration (Agents)

**Group:** D (Parallel with 07)
**Dependencies:** 05-migrate-slug-apis
**Blocks:** 08-cleanup

---

## Goal

Replace direct `writeFileSync` calls in agent code with a `ThreadWriter` that handles path resolution with lazy fallback.

---

## File to Create

### `agents/src/services/thread-writer.ts`

```typescript
import { ResolutionService } from "../../../core/services/resolution-service";
import { FSAdapter } from "../../../core/services/fs-adapter";
import { join } from "path";

export class ThreadWriter {
  private cachedPath: string | null = null;

  constructor(
    private resolution: ResolutionService,
    private fs: FSAdapter,
    private threadId: string
  ) {}

  /**
   * Write to thread directory. O(1) if hintPath valid, O(n) fallback on failure.
   */
  async write(filename: string, content: string, hintPath?: string): Promise<string> {
    const pathToTry = hintPath ?? this.cachedPath;

    // O(1): Try hint/cached path first
    if (pathToTry) {
      const filePath = join(pathToTry, filename);
      try {
        if (await this.fs.exists(pathToTry)) {
          await this.fs.writeFile(filePath, content);
          this.cachedPath = pathToTry;
          return filePath;
        }
      } catch {
        // Fall through to resolution
      }
    }

    // O(n): Fallback - resolve and retry
    const resolved = await this.resolution.resolveThread(this.threadId, pathToTry ?? undefined);
    if (!resolved) {
      throw new Error(`Thread not found: ${this.threadId}`);
    }

    if (pathToTry && resolved.threadDir !== pathToTry) {
      console.error(`[ThreadWriter] Path changed: ${pathToTry} → ${resolved.threadDir}`);
    }

    const filePath = join(resolved.threadDir, filename);
    await this.fs.writeFile(filePath, content);
    this.cachedPath = resolved.threadDir;
    return filePath;
  }

  async writeMetadata(metadata: object, hintPath?: string): Promise<string> {
    return this.write("metadata.json", JSON.stringify(metadata, null, 2), hintPath);
  }

  async writeState(state: object, hintPath?: string): Promise<string> {
    return this.write("state.json", JSON.stringify(state), hintPath);
  }

  getCachedPath(): string | null {
    return this.cachedPath;
  }
}
```

---

## Files to Modify

### `agents/src/runner.ts`

#### Add Imports and Setup

```typescript
import { NodeFSAdapter } from "./adapters/node-fs-adapter";
import { ResolutionService } from "../../core/services/resolution-service";
import { ThreadWriter } from "./services/thread-writer";

// Near top of run():
const fsAdapter = new NodeFSAdapter();
const resolution = new ResolutionService(fsAdapter, join(args.mortDir, "tasks"));
const threadWriter = new ThreadWriter(resolution, fsAdapter, args.threadId);
```

#### Replace Direct Writes

| Line | Current | Replace With |
|------|---------|--------------|
| 403 | `writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))` | `await threadWriter.writeMetadata(metadata, threadPath)` |
| 604 | `writeFileSync(metadataPath, ...)` | `await threadWriter.writeMetadata(...)` |
| 624 | `writeFileSync(metadataPath, ...)` | `await threadWriter.writeMetadata(...)` |

### `agents/src/output.ts`

#### Change Signature

```typescript
// Before
export function initState(threadPath: string): StateManager

// After
export function initState(writer: ThreadWriter, hintPath: string): StateManager
```

#### Update Implementation

```typescript
export function initState(writer: ThreadWriter, hintPath: string) {
  return {
    updateState: async (state: ThreadState) => {
      await writer.writeState(state, hintPath);
    }
  };
}
```

---

## Critical Writes to Migrate

| File | Line | Operation | Risk Level |
|------|------|-----------|------------|
| `runner.ts:403` | Thread metadata initial | CRITICAL |
| `runner.ts:604` | Completion metadata | CRITICAL |
| `runner.ts:624` | Error metadata | CRITICAL |
| `output.ts:71` | state.json continuous | CRITICAL |

---

## Verification

- [ ] `ThreadWriter` created and exported
- [ ] `runner.ts` uses `ThreadWriter` for all metadata writes
- [ ] `output.ts` receives `ThreadWriter` and uses for state.json
- [ ] No remaining direct `writeFileSync` to thread directories
- [ ] Path resolution logs when task was renamed mid-execution
- [ ] Agent tests pass
