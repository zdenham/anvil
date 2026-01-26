# Relative Path Display for Tool Blocks

## Overview

Currently, tool blocks display absolute file paths (e.g., `/Users/zac/Documents/project/src/file.ts`). This plan outlines implementing helpers to display **relative paths** (e.g., `src/file.ts`) and **file names only** (e.g., `file.ts`), making the UI cleaner and more readable.

## Current State Analysis

### Tool Blocks That Display File Paths

| Tool Block | File | Path Parameter | Display Location | Notes |
|------------|------|----------------|------------------|-------|
| **ReadToolBlock** | `read-tool-block.tsx:73-74` | `file_path` | Second line header | Shows full path |
| **WriteToolBlock** | `write-tool-block.tsx:111-113` | `file_path` | Second line header | Shows full path |
| **EditToolBlock** | `edit-tool-block.tsx:133-134` | `file_path` | Second line header | Shows full path |
| **GlobToolBlock** | `glob-tool-block.tsx:164,175-176` | `path` (search location) + result paths | Search context + expanded results | Shows full paths in results |
| **GrepToolBlock** | `grep-tool-block.tsx` | `path` (search location) + result file paths | Multiple locations | Full paths throughout |
| **LSPToolBlock** | `lsp-tool-block.tsx:122-127` | `filePath` (camelCase) | Second line + results | Has `uriToPath()` helper but still shows full path |
| **NotebookEditToolBlock** | `notebook-edit-tool-block.tsx:184` | `notebook_path` | Second line (filename only) | Already extracts filename via `getFilename()` |

### Existing Patterns

1. **NotebookEditToolBlock** already has a `getFilename()` helper (line 87-89):
   ```typescript
   function getFilename(path: string): string {
     return path.split("/").pop() ?? path;
   }
   ```

2. **LSPToolBlock** has a `uriToPath()` helper for file:// URIs but still shows full paths.

3. **No centralized path utilities exist** - each component handles paths directly.

4. **Thread context available**: Tool blocks receive `threadId` via props, but not the working directory.

### Context Sources

- `useWorkingDirectory` hook (`src/hooks/use-working-directory.ts`) can derive working directory from thread metadata
- Repository settings contain `sourcePath` (main repo) and `worktrees[].path`
- Thread metadata contains `repoId` and `worktreeId`

## Implementation Plan

### Phase 1: Create Path Utility Module

**File**: `src/lib/utils/path-display.ts`

```typescript
/**
 * Path display utilities for tool blocks.
 *
 * Provides performant helpers to convert absolute paths to:
 * - Relative paths (relative to workspace root)
 * - Home-relative paths (~/...) for external files
 * - File names only
 */

// Cache home directory - won't change during session
const HOME_DIR = typeof window !== "undefined"
  ? (window as any).__TAURI__?.path?.homeDir?.() ?? ""
  : process.env.HOME ?? "";

/**
 * Convert an absolute path to a display-friendly path.
 *
 * Priority:
 * 1. If within workspace root -> relative path (e.g., "src/file.ts")
 * 2. If within home directory -> home-relative path (e.g., "~/other/file.ts")
 * 3. Otherwise -> absolute path as-is
 *
 * @param absolutePath - The absolute file path
 * @param workspaceRoot - The workspace root directory
 * @returns Display-friendly path
 *
 * Performance: O(1) string operations, no filesystem access
 */
export function toRelativePath(
  absolutePath: string,
  workspaceRoot: string
): string {
  if (!absolutePath) {
    return "";
  }

  // Check workspace root first (most common case)
  if (workspaceRoot) {
    const normalizedRoot = workspaceRoot.endsWith("/")
      ? workspaceRoot.slice(0, -1)
      : workspaceRoot;

    if (absolutePath.startsWith(normalizedRoot + "/")) {
      return absolutePath.slice(normalizedRoot.length + 1);
    }
  }

  // Fall back to home-relative path for external files
  if (HOME_DIR && absolutePath.startsWith(HOME_DIR + "/")) {
    return "~" + absolutePath.slice(HOME_DIR.length);
  }

  // Path is outside home, return as-is
  return absolutePath;
}

/**
 * Extract just the file name from a path.
 *
 * @param path - Absolute or relative file path
 * @returns File name only (e.g., "file.ts")
 *
 * Performance: O(1) string operations
 */
export function toFileName(path: string): string {
  if (!path) return "";

  // Handle both forward and back slashes
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/**
 * Convert multiple paths to display-friendly paths efficiently.
 * Useful for batch processing (e.g., glob/grep results).
 *
 * @param absolutePaths - Array of absolute file paths
 * @param workspaceRoot - The workspace root directory
 * @returns Array of display-friendly paths
 */
export function toRelativePaths(
  absolutePaths: string[],
  workspaceRoot: string
): string[] {
  // Pre-compute normalized roots for efficiency
  const normalizedWorkspace = workspaceRoot?.endsWith("/")
    ? workspaceRoot.slice(0, -1)
    : workspaceRoot;
  const workspacePrefix = normalizedWorkspace ? normalizedWorkspace + "/" : "";
  const workspacePrefixLen = workspacePrefix.length;

  const homePrefix = HOME_DIR ? HOME_DIR + "/" : "";
  const homePrefixLen = HOME_DIR?.length ?? 0;

  return absolutePaths.map(p => {
    if (workspacePrefix && p.startsWith(workspacePrefix)) {
      return p.slice(workspacePrefixLen);
    }
    if (homePrefix && p.startsWith(homePrefix)) {
      return "~" + p.slice(homePrefixLen);
    }
    return p;
  });
}
```

### Phase 2: Create Workspace Context Hook

**File**: `src/hooks/use-workspace-root.ts`

```typescript
import { useThreadsStore } from "@/entities/threads";
import { useWorkingDirectory } from "./use-working-directory";

/**
 * Hook to get the workspace root for path display.
 * Uses existing useWorkingDirectory which handles async fetch and caching.
 *
 * @param threadId - The thread ID
 * @returns Workspace root path, or empty string if not yet resolved
 */
export function useWorkspaceRoot(threadId: string): string {
  const thread = useThreadsStore((state) => state.threads[threadId]?.metadata);
  return useWorkingDirectory(thread);
}
```

The existing `useWorkingDirectory` hook handles the async fetch once per thread and caches the result in state. All subsequent relative path calculations are cheap synchronous string operations.

### Phase 3: Update Tool Blocks

#### 3.1 ReadToolBlock (`read-tool-block.tsx`)

```diff
+ import { toRelativePath } from "@/lib/utils/path-display";
+ import { useWorkspaceRoot } from "@/hooks/use-workspace-root";

export function ReadToolBlock({ ..., threadId }: ToolBlockProps) {
+   const workspaceRoot = useWorkspaceRoot(threadId);
    const filePath = readInput.file_path || "";
+   const displayPath = toRelativePath(filePath, workspaceRoot);

    // In render:
-   <code className="...">{filePath}</code>
+   <code className="...">{displayPath}</code>
    // Keep CopyButton with full path for functionality
    <CopyButton text={filePath} label="Copy file path" />
}
```

#### 3.2 WriteToolBlock (`write-tool-block.tsx`)

Same pattern as ReadToolBlock.

#### 3.3 EditToolBlock (`edit-tool-block.tsx`)

Same pattern as ReadToolBlock.

#### 3.4 GlobToolBlock (`glob-tool-block.tsx`)

```diff
+ import { toRelativePath, toRelativePaths } from "@/lib/utils/path-display";
+ import { useWorkspaceRoot } from "@/hooks/use-workspace-root";

export function GlobToolBlock({ ..., threadId }: ToolBlockProps) {
+   const workspaceRoot = useWorkspaceRoot(threadId);
    const searchPath = globInput.path || ".";
+   const displaySearchPath = toRelativePath(searchPath, workspaceRoot);

    // For results - convert all at once for efficiency
    const filePaths = parseGlobResult(result);
+   const displayPaths = useMemo(
+     () => toRelativePaths(filePaths, workspaceRoot),
+     [filePaths, workspaceRoot]
+   );

    // In render (search context):
-   <span className="text-zinc-400">{searchPath}</span>
+   <span className="text-zinc-400">{displaySearchPath}</span>

    // In render (file list):
-   {filePaths.map((filePath, index) => (
+   {displayPaths.map((displayPath, index) => (
      <div key={...}>
-       <code>{filePath}</code>
+       <code>{displayPath}</code>
-       <CopyButton text={filePath} ... />
+       <CopyButton text={filePaths[index]} ... /> {/* Keep full path for copy */}
      </div>
    ))}
}
```

#### 3.5 GrepToolBlock (`grep-tool-block.tsx`)

Similar to GlobToolBlock but with more locations:
- File headers in content mode
- File list in files mode
- Count table rows

#### 3.6 LSPToolBlock (`lsp-tool-block.tsx`)

Update `uriToPath()` and other path displays to use relative paths.

#### 3.7 NotebookEditToolBlock (`notebook-edit-tool-block.tsx`)

Already shows filename only in header. Could optionally show relative path on hover or in expanded view.

### Phase 4: Testing

**File**: `src/lib/utils/path-display.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { toRelativePath, toFileName, toRelativePaths } from "./path-display";

describe("toRelativePath", () => {
  it("converts absolute path within workspace to relative", () => {
    expect(toRelativePath(
      "/Users/zac/project/src/file.ts",
      "/Users/zac/project"
    )).toBe("src/file.ts");
  });

  it("handles workspace root with trailing slash", () => {
    expect(toRelativePath(
      "/Users/zac/project/src/file.ts",
      "/Users/zac/project/"
    )).toBe("src/file.ts");
  });

  it("converts external home paths to ~/...", () => {
    // Assumes HOME_DIR is /Users/zac
    expect(toRelativePath(
      "/Users/zac/other-project/file.ts",
      "/Users/zac/project"
    )).toBe("~/other-project/file.ts");
  });

  it("returns absolute path for paths outside home", () => {
    expect(toRelativePath(
      "/var/log/file.ts",
      "/Users/zac/project"
    )).toBe("/var/log/file.ts");
  });

  it("handles empty inputs gracefully", () => {
    expect(toRelativePath("", "/workspace")).toBe("");
    expect(toRelativePath("/path/file.ts", "")).toBe("/path/file.ts");
  });

  it("handles deeply nested paths", () => {
    expect(toRelativePath(
      "/Users/zac/project/src/components/ui/button.tsx",
      "/Users/zac/project"
    )).toBe("src/components/ui/button.tsx");
  });
});

describe("toFileName", () => {
  it("extracts filename from path", () => {
    expect(toFileName("/Users/zac/project/src/file.ts")).toBe("file.ts");
    expect(toFileName("src/file.ts")).toBe("file.ts");
    expect(toFileName("file.ts")).toBe("file.ts");
  });

  it("handles empty input", () => {
    expect(toFileName("")).toBe("");
  });
});

describe("toRelativePaths", () => {
  it("converts array of paths efficiently", () => {
    const paths = [
      "/Users/zac/project/src/a.ts",
      "/Users/zac/project/src/b.ts",
      "/Users/zac/other/c.ts",
      "/var/log/d.ts",
    ];
    expect(toRelativePaths(paths, "/Users/zac/project")).toEqual([
      "src/a.ts",
      "src/b.ts",
      "~/other/c.ts",
      "/var/log/d.ts",
    ]);
  });
});
```

## Implementation Order

1. **Create `src/lib/utils/path-display.ts`** - Pure utility functions, no dependencies
2. **Add tests `src/lib/utils/path-display.test.ts`** - Verify correctness
3. **Create `src/hooks/use-workspace-root.ts`** - Or decide on alternative context approach
4. **Update tool blocks** in this order (simplest to most complex):
   - ReadToolBlock
   - WriteToolBlock
   - EditToolBlock
   - NotebookEditToolBlock (minor - maybe add relative path on hover)
   - GlobToolBlock
   - GrepToolBlock
   - LSPToolBlock
5. **Manual testing** - Verify paths display correctly across different scenarios

## Design Decisions

### Why show relative paths?
- Absolute paths are verbose and waste horizontal space
- Users mentally model files relative to their project root
- Better matches VS Code, terminal, and other dev tool conventions

### Why keep full path for CopyButton?
- When copying, users typically want the full path to paste in terminal/editor
- Relative paths may not work depending on user's current directory

### Performance considerations
- Path conversion is O(1) string operations - no filesystem access
- `toRelativePaths` processes batches without repeated normalization
- `useMemo` prevents recalculation on re-renders
- No async operations in the hot path

### Alternative: Store relative paths in tool results
Instead of converting at display time, we could:
1. Have the agent store relative paths in tool inputs/results
2. Convert on the backend when logging

**Rejected because**:
- Would require changes to agent tool definitions
- Breaks copy-to-clipboard use case
- Less flexible if user wants to see full paths

## Design Decisions (Resolved)

1. **No toggle** - Always show relative paths. Keeps it simple.

2. **Async hook is fine** - The existing `useWorkingDirectory` hook fetches once per thread and caches the result. All relative path calculations are cheap synchronous string operations thereafter.

3. **External paths use `~/`** - For paths outside the workspace but inside the user's home directory, show `~/path/to/file.ts`. Other external paths show as-is.
