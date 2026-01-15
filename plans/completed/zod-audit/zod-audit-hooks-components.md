# Zod Audit: Hooks and Components

Audit of `/src/hooks/` and `/src/components/` directories for Zod migration opportunities.

**Key Principle**: Use Zod ONLY at trust boundaries where data comes from outside TypeScript (disk, network, IPC, user input). Don't use Zod for internal types, interfaces with methods, React props, etc.

**Important**: When adding Zod schemas, always derive the TypeScript type from the schema using `z.infer<typeof Schema>`. Never maintain duplicate type definitions - the schema IS the type definition.

## Summary

**Current state**: Neither hooks nor components directories contain any Zod usage currently. This is mostly correct - component props and internal hook types should NOT use Zod.

**Findings**:
- 0 files incorrectly using Zod (good - no cleanup needed)
- 6 files that SHOULD add Zod validation for IPC/external data
- 1 service file (`prompt-history-service.ts`) that reads JSON from disk without validation (related but out of scope)
- All other files correctly use plain TypeScript for internal types

---

## Files That Need Zod Validation

### 1. `/src/hooks/use-git-commits.ts`

**Current state**: Receives `GitCommit[]` from Tauri IPC (`git_get_branch_commits`) without validation.

**Issue**: The `GitCommit` interface is defined locally but the data comes from Rust via IPC - a trust boundary.

**Recommended action**: Add Zod schema for runtime validation of IPC response. Replace the interface with `z.infer<typeof Schema>`.

```typescript
// Current (no validation - REMOVE this interface)
export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  relativeDate: string;
}

const result = await invoke<GitCommit[]>("git_get_branch_commits", { ... });

// Recommended (with Zod - schema IS the type)
import { z } from "zod";

export const GitCommitSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  message: z.string(),
  author: z.string(),
  authorEmail: z.string(),
  date: z.string(),
  relativeDate: z.string(),
});
export type GitCommit = z.infer<typeof GitCommitSchema>;

const GitCommitArraySchema = z.array(GitCommitSchema);

// In fetchCommits:
const rawResult = await invoke<unknown>("git_get_branch_commits", { ... });
const result = GitCommitArraySchema.parse(rawResult);
```

**Note**: The `UseGitCommitsResult` interface should remain as plain TypeScript - it's an internal return type, not IPC data.

---

### 2. `/src/components/clipboard/types.ts` + `/src/components/clipboard/clipboard-manager.tsx`

**Current state**: Receives `ClipboardEntryPreview[]` and clipboard content from Tauri IPC without validation.

**Issue**: Data from `get_clipboard_history` and `get_clipboard_content` IPC commands crosses trust boundary.

**Recommended action**: Update `types.ts` to use Zod schemas. Delete the existing interfaces and replace with schema-derived types.

**File to update**: `/src/components/clipboard/types.ts`

```typescript
// Current (plain interfaces - DELETE these)
export interface ClipboardEntryPreview {
  id: string;
  preview: string;
  content_size: number;
  timestamp: number;
  app_source: string | null;
}

export interface ClipboardEntry extends ClipboardEntryPreview {
  content: string;
}

// Recommended (Zod schemas - schema IS the type)
import { z } from "zod";

export const ClipboardEntryPreviewSchema = z.object({
  id: z.string(),
  preview: z.string(),
  content_size: z.number(),
  timestamp: z.number(),
  app_source: z.string().nullable(),
});
export type ClipboardEntryPreview = z.infer<typeof ClipboardEntryPreviewSchema>;

export const ClipboardEntrySchema = ClipboardEntryPreviewSchema.extend({
  content: z.string(),
});
export type ClipboardEntry = z.infer<typeof ClipboardEntrySchema>;
```

Then in `clipboard-manager.tsx`:
```typescript
import { ClipboardEntryPreviewSchema } from "./types";

// In ClipboardController.getHistory:
const raw = await invoke<unknown>("get_clipboard_history", { query });
return z.array(ClipboardEntryPreviewSchema).parse(raw);

// In ClipboardController.getContent - returns string|null, no schema needed
// (primitive types don't need Zod validation)
```

---

### 3. `/src/components/spotlight/types.ts` + `/src/components/spotlight/spotlight.tsx`

**Current state**: Multiple IPC calls without validation:
- `search_applications` returns `AppResult[]`
- `get_paths_info` returns `PathsInfo` (defined locally in spotlight.tsx)

**Issue**: IPC responses cross trust boundary. `PathsInfo` is also duplicated in `/src/lib/filesystem-client.ts`.

**Recommended action**:
1. Update `types.ts` to use Zod for `AppResult` (IPC data)
2. Create shared `PathsInfoSchema` in `/src/lib/types/paths.ts`
3. Keep `CalculatorResult`, `TaskResult`, `ActionResult`, etc. as plain interfaces (internal types)

**File to update**: `/src/components/spotlight/types.ts`

```typescript
import { z } from "zod";

// IPC data - needs Zod (DELETE existing interface)
export const AppResultSchema = z.object({
  name: z.string(),
  path: z.string(),
  icon_path: z.string().nullable(),
});
export type AppResult = z.infer<typeof AppResultSchema>;

// Internal types - keep as plain interfaces (NO Zod needed)
export interface CalculatorResult {
  displayExpression: string;
  result: number | null;
  isValid: boolean;
}

export interface TaskResult {
  query: string;
}

export interface OpenRepoResult {
  action: "open-repo";
}

export interface OpenMortResult {
  action: "open-mort";
}

export type ActionResult = OpenRepoResult | OpenMortResult;

export type SpotlightResult =
  | { type: "app"; data: AppResult }
  | { type: "calculator"; data: CalculatorResult }
  | { type: "task"; data: TaskResult }
  | { type: "action"; data: ActionResult };
```

**New file**: `/src/lib/types/paths.ts` (shared schema)
```typescript
import { z } from "zod";

export const PathsInfoSchema = z.object({
  data_dir: z.string(),
  config_dir: z.string(),
  app_suffix: z.string(),
  is_alternate_build: z.boolean(),
});
export type PathsInfo = z.infer<typeof PathsInfoSchema>;
```

Then in `spotlight.tsx`:
```typescript
import { AppResultSchema } from "./types";
import { PathsInfoSchema } from "@/lib/types/paths";

// DELETE the local PathsInfo interface (lines 399-404)

// In search():
const raw = await invoke<unknown>("search_applications", { query });
const appResults = z.array(AppResultSchema).parse(raw);

// In useEffect:
const raw = await invoke<unknown>("get_paths_info");
const info = PathsInfoSchema.parse(raw);
```

**Also update**: `/src/lib/filesystem-client.ts`
- Delete the duplicate `PathsInfo` interface
- Import from `@/lib/types/paths` instead

---

### 4. `/src/components/simple-task/use-simple-task-params.ts`

**Current state**: Receives `PendingSimpleTask` from IPC and event listener without validation.

**Issue**: Data from `get_pending_simple_task` IPC and `open-simple-task` event crosses trust boundary.

**Recommended action**: Add Zod schemas for IPC/event data. Delete the existing interfaces.

```typescript
// Current (no validation - DELETE these interfaces)
interface SimpleTaskParams {
  taskId: string;
  threadId: string;
  prompt?: string;
}

interface PendingSimpleTask {
  thread_id: string;
  task_id: string;
  prompt?: string;
}

const pending = await invoke<PendingSimpleTask | null>("get_pending_simple_task");

// Recommended (with Zod - schema IS the type)
import { z } from "zod";

// IPC data from Rust (snake_case)
const PendingSimpleTaskSchema = z.object({
  thread_id: z.string(),
  task_id: z.string(),
  prompt: z.string().optional(),
});
type PendingSimpleTask = z.infer<typeof PendingSimpleTaskSchema>;

// Event data from TypeScript (camelCase)
const OpenSimpleTaskEventSchema = z.object({
  threadId: z.string(),
  taskId: z.string(),
  prompt: z.string().optional(),
});

// Internal type - keep as plain interface
interface SimpleTaskParams {
  taskId: string;
  threadId: string;
  prompt?: string;
}

// In useEffect:
const raw = await invoke<unknown>("get_pending_simple_task");
const pending = raw ? PendingSimpleTaskSchema.parse(raw) : null;

// In event listener:
const unlisten = listen<unknown>("open-simple-task", (event) => {
  const payload = OpenSimpleTaskEventSchema.parse(event.payload);
  setParams({
    taskId: payload.taskId,
    threadId: payload.threadId,
    prompt: payload.prompt,
  });
});
```

**Note**: `SimpleTaskParams` can remain as a plain interface since it's the internal return type of the hook, not IPC data.

---

### 5. `/src/components/error-panel.tsx`

**Current state**: Receives `PendingError` from IPC and `ErrorPayload` from events without validation.

**Issue**: Data from `get_pending_error` IPC and `show-error` event crosses trust boundary. Note: `ErrorPayload` and `PendingError` are identical types but defined separately.

**Recommended action**: Consolidate into a single Zod schema. Delete both interfaces.

```typescript
// Current (no validation - DELETE these interfaces)
interface ErrorPayload {
  message: string;
  stack?: string;
}

interface PendingError {
  message: string;
  stack?: string;
}

// Recommended (with Zod - single schema for both uses)
import { z } from "zod";

const ErrorPayloadSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
});
type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

// In useEffect:
const raw = await invoke<unknown>("get_pending_error");
const pendingError = raw ? ErrorPayloadSchema.parse(raw) : null;

// In event listener:
const unlistenError = listen<unknown>("show-error", (event) => {
  const payload = ErrorPayloadSchema.parse(event.payload);
  setError(payload);
});
```

**Cleanup**: Remove the redundant `PendingError` interface - use `ErrorPayload` for both IPC and event data.

---

### 6. `/src/components/ui/BuildModeIndicator.tsx`

**Current state**: Receives `PathsInfo` from IPC without validation. Has a local `PathsInfo` interface that duplicates the one in `filesystem-client.ts` and `spotlight.tsx`.

**Issue**: Same as spotlight.tsx - `get_paths_info` IPC response crosses trust boundary.

**Recommended action**: Use the shared `PathsInfoSchema` from `/src/lib/types/paths.ts` (created in item #3). Delete the local interface.

```typescript
// Current (DELETE this local interface)
interface PathsInfo {
  data_dir: string;
  config_dir: string;
  app_suffix: string;
  is_alternate_build: boolean;
}

// Recommended - import shared schema
import { PathsInfoSchema } from "@/lib/types/paths";

// In useEffect:
const raw = await invoke<unknown>("get_paths_info");
const info = PathsInfoSchema.parse(raw);
setSuffix(info.app_suffix);
```

**Note**: This is the third place `PathsInfo` is defined. The shared schema eliminates all three duplicates.

---

## Files With Correct Plain TypeScript Usage

These files correctly use plain TypeScript types because they don't handle external data:

### Hooks (internal types - correct)

| File | Types | Why Plain TS is Correct |
|------|-------|------------------------|
| `use-relative-time.ts` | None | Uses primitive types only |
| `use-reduced-motion.ts` | None | Uses primitive types only |
| `use-file-contents.ts` | `UseFileContentsResult` | Return type interface (internal). Note: uses IPC internally but validates via `fsCommands` wrapper |
| `use-delete-task.ts` | None | Uses imported `TaskMetadata` type |
| `use-task-board.ts` | `GroupedTasks`, `TaskBoardFilters` | Internal UI grouping types |
| `use-task-threads.ts` | None | Uses imported `ThreadMetadata` type |
| `use-action-state.ts` | `ActionState` | Internal union type for UI state |

### Component Types (internal - correct)

| File | Types | Why Plain TS is Correct |
|------|-------|------------------------|
| `diff-viewer/types.ts` | `ParsedDiff*`, `Annotated*`, `DiffViewerProps` | Internal types and component props |
| `spotlight/types.ts` (partial) | `CalculatorResult`, `TaskResult`, `ActionResult`, `SpotlightResult` | Internal computation results and discriminated unions |

### Component Hooks (internal - correct)

| File | Types | Why Plain TS is Correct |
|------|-------|------------------------|
| `use-diff-navigation.ts` | `UseDiffNavigationOptions` | Hook options (internal) |
| `use-diff-keyboard.ts` | `UseDiffKeyboardOptions` | Hook options (internal) |
| `use-collapsed-regions.ts` | `UseCollapsedRegionsResult`, `RenderItem` | Internal state types |
| `use-spotlight-history.ts` | `UseSpotlightHistoryOptions/Result` | Hook options (internal) |

---

## Related Files (Out of Scope but Notable)

These files have trust boundary issues but are outside the hooks/components directories:

### `/src/lib/prompt-history-service.ts`
Reads JSON from disk (`prompt-history.json`) without Zod validation. The `PromptHistoryData` and `PromptHistoryEntry` interfaces should be Zod schemas.

### `/src/lib/tauri-commands.ts`
Defines `WorktreeInfo` and `ThreadMetadata` interfaces for IPC responses. These should be Zod schemas since they come from Rust.

### `/src/lib/filesystem-client.ts`
Defines `DirEntry` and `PathsInfo` interfaces for IPC responses. `PathsInfo` is duplicated (see item #3 above). Both should be Zod schemas.

---

## Implementation Priority

1. **High**: Create `/src/lib/types/paths.ts` - Shared schema used by 3 files, eliminates duplication
2. **High**: `use-git-commits.ts` - Simple, isolated change
3. **High**: `clipboard/types.ts` + `clipboard-manager.tsx` - User-facing data
4. **Medium**: `spotlight/types.ts` + `spotlight.tsx` - Multiple IPC calls (depends on #1)
5. **Medium**: `use-simple-task-params.ts` - Event/IPC validation
6. **Low**: `error-panel.tsx` - Error data (less critical)
7. **Low**: `BuildModeIndicator.tsx` - Simple change (depends on #1)

---

## Shared Schema Opportunities

### `PathsInfo` (3 duplicates - HIGH priority)
Currently defined in:
- `/src/components/spotlight/spotlight.tsx` (local interface)
- `/src/components/ui/BuildModeIndicator.tsx` (local interface)
- `/src/lib/filesystem-client.ts` (exported interface)

**Action**: Create `/src/lib/types/paths.ts` with `PathsInfoSchema`, delete all 3 duplicates.

### Future Consideration: `/src/lib/types/ipc-schemas.ts`
If more IPC schemas are needed, consider consolidating common ones into a single file. Current candidates:
- `PathsInfoSchema` (definite)
- `DirEntrySchema` (from filesystem-client.ts)
- `WorktreeInfoSchema` (from tauri-commands.ts)

---

## Checklist for Implementation

For each file that needs Zod validation:

- [ ] Import `z` from "zod"
- [ ] Create the schema with `Schema` suffix (e.g., `GitCommitSchema`)
- [ ] **DELETE the existing interface** - do not keep both
- [ ] Derive the type with `z.infer<typeof Schema>`
- [ ] Change `invoke<Type>` to `invoke<unknown>`
- [ ] Add `.parse()` call on the result
- [ ] Export schema if it might be reused
- [ ] Run type checker to verify no regressions

---

## Error Handling Considerations

When Zod validation fails, `.parse()` throws a `ZodError`. Consider these strategies:

### Option 1: Let errors propagate (recommended for most cases)
```typescript
// Zod errors bubble up to error boundaries or catch blocks
const result = GitCommitArraySchema.parse(rawResult);
```

### Option 2: Use `.safeParse()` for graceful degradation
```typescript
const parsed = GitCommitArraySchema.safeParse(rawResult);
if (!parsed.success) {
  logger.error("[useGitCommits] Invalid IPC response:", parsed.error);
  return []; // or throw custom error
}
return parsed.data;
```

### Option 3: Use `.catch()` for default values
```typescript
const result = GitCommitArraySchema.catch([]).parse(rawResult);
```

For this codebase, **Option 1** is recommended since:
- Validation failures indicate a serious contract mismatch between Rust and TypeScript
- These errors should surface loudly during development
- The existing error handling (try/catch in hooks) will catch these
