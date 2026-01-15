# 04: Resolution Service Implementation

**Group:** B (Parallel with 02, 03)
**Dependencies:** 01-types-and-interface
**Blocks:** 05-migrate-slug-apis

---

## Goal

Create the shared resolution logic that works with any FSAdapter.

---

## File to Create

### `core/services/resolution-service.ts`

```typescript
import { FSAdapter } from "./fs-adapter";
import { TaskResolution, ThreadResolution } from "../types/resolution";
import { join } from "path";

/**
 * Shared resolution logic - same code for both Node.js and Tauri.
 * Platform differences handled by FSAdapter.
 */
export class ResolutionService {
  constructor(
    private fs: FSAdapter,
    private tasksDir: string
  ) {}

  /**
   * Resolve task by ID. O(1) if hintSlug is correct, O(n) fallback otherwise.
   */
  async resolveTask(taskId: string, hintSlug?: string): Promise<TaskResolution | null> {
    // O(1): Try hint first
    if (hintSlug) {
      const result = await this.tryTaskPath(taskId, hintSlug);
      if (result) return result;
    }

    // O(n): Fallback to directory scan
    return this.scanForTask(taskId);
  }

  /**
   * Resolve thread by ID. O(1) if hintPath provided and valid, O(n) glob fallback.
   */
  async resolveThread(threadId: string, hintPath?: string): Promise<ThreadResolution | null> {
    // O(1): Try hint first
    if (hintPath) {
      const metaPath = join(hintPath, "metadata.json");
      if (await this.fs.exists(metaPath)) {
        const meta = JSON.parse(await this.fs.readFile(metaPath));
        if (meta.id === threadId) {
          return this.buildThreadResolution(hintPath, meta);
        }
      }
    }

    // O(n): Fallback to glob
    return this.scanForThread(threadId);
  }

  private async tryTaskPath(taskId: string, slug: string): Promise<TaskResolution | null> {
    const metaPath = join(this.tasksDir, slug, "metadata.json");
    if (!await this.fs.exists(metaPath)) return null;

    const meta = JSON.parse(await this.fs.readFile(metaPath));
    if (meta.id !== taskId) return null;

    return {
      taskId,
      slug,
      taskDir: join(this.tasksDir, slug),
      branchName: meta.branchName,
    };
  }

  private async scanForTask(taskId: string): Promise<TaskResolution | null> {
    const dirs = await this.fs.readDir(this.tasksDir);
    for (const slug of dirs) {
      const result = await this.tryTaskPath(taskId, slug);
      if (result) return result;
    }
    return null;
  }

  private async scanForThread(threadId: string): Promise<ThreadResolution | null> {
    const pattern = `*/threads/*-${threadId}/metadata.json`;
    const matches = await this.fs.glob(pattern, this.tasksDir);
    if (matches.length === 0) return null;

    const metaPath = join(this.tasksDir, matches[0]);
    const meta = JSON.parse(await this.fs.readFile(metaPath));
    return this.buildThreadResolution(
      join(this.tasksDir, matches[0].replace("/metadata.json", "")),
      meta
    );
  }

  private buildThreadResolution(threadDir: string, meta: any): ThreadResolution {
    // Extract taskSlug from path: tasks/{taskSlug}/threads/{threadFolder}
    const parts = threadDir.split("/");
    const threadsIdx = parts.indexOf("threads");
    const taskSlug = parts[threadsIdx - 1];

    return {
      threadId: meta.id,
      taskId: meta.taskId,
      taskSlug,
      threadDir,
      agentType: meta.agentType,
    };
  }
}
```

---

## Design Notes

- **O(1) fast path:** Always tries hint/expected path first
- **O(n) fallback:** Only scans when fast path fails
- **Platform agnostic:** All FS operations through adapter
- **No caching:** Caller can cache results if needed

---

## Verification

- [ ] File created at `core/services/resolution-service.ts`
- [ ] `resolveTask` works with hint (O(1) path)
- [ ] `resolveTask` works without hint (O(n) scan)
- [ ] `resolveThread` works with hint (O(1) path)
- [ ] `resolveThread` works without hint (O(n) glob)
- [ ] Unit tests with mock FSAdapter
