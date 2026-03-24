# Zod Audit: src/lib Directory

Audit performed according to criteria in `/docs/patterns/zod-boundaries.md`.

## Summary

The `src/lib` directory contains 38 TypeScript files that handle:
- Tauri IPC commands (data from Rust backend)
- Agent process output parsing (JSON from child process stdout)
- Disk persistence (reading/writing JSON files)
- Event bridging (IPC between Tauri windows)
- UI utilities and internal helpers

**Key Finding**: The codebase currently uses **no Zod schemas** in `src/lib`. Most files use plain TypeScript types, which is correct for internal utilities. However, several files read data from trust boundaries (IPC, disk, child processes) without runtime validation.

## Critical Issue: Redundant Type Definitions

Before adding Zod schemas, consolidate duplicate types. The codebase has several type definitions that should be unified using `z.infer<typeof Schema>`:

### 1. `RepositoryMetadata` - defined in TWO places with DIFFERENT signatures
- `/Users/zac/Documents/juice/anvil/anvil/src/lib/repo-store-client.ts` - uses `createdAt: string`
- `/Users/zac/Documents/juice/anvil/anvil/src/entities/repositories/types.ts` - uses `createdAt: number`

**Action**: Delete the `repo-store-client.ts` version, create a schema in `entities/repositories/types.ts`, use `z.infer`.

### 2. `RepositoryVersion` - defined in TWO places with DIFFERENT signatures
- `/Users/zac/Documents/juice/anvil/anvil/src/lib/repo-store-client.ts` - uses `createdAt: string`
- `/Users/zac/Documents/juice/anvil/anvil/src/entities/repositories/types.ts` - uses `createdAt: number`

**Action**: Same as above - consolidate.

### 3. `ThreadStatus` - defined in THREE places
- `/Users/zac/Documents/juice/anvil/anvil/src/lib/tauri-commands.ts` - `"running" | "completed" | "error" | "paused"`
- `/Users/zac/Documents/juice/anvil/anvil/src/entities/threads/types.ts` - `"idle" | "running" | "completed" | "error" | "paused"`
- `/Users/zac/Documents/juice/anvil/anvil/core/types/events.ts` - `ThreadStatusType` with same values as threads/types.ts

**Action**: Keep single definition in `src/entities/threads/types.ts`, import everywhere else. The tauri-commands.ts version is missing "idle" which may cause runtime bugs.

### 4. `ThreadMetadata` - defined in TWO places with DIFFERENT signatures
- `/Users/zac/Documents/juice/anvil/anvil/src/lib/tauri-commands.ts` - minimal version (id, taskId, status)
- `/Users/zac/Documents/juice/anvil/anvil/src/entities/threads/types.ts` - full version with all fields

**Action**: Delete tauri-commands.ts version, import from entities/threads/types.ts.

## Files Analysis

### Files That SHOULD Use Zod (trust boundary data)

#### 1. `/Users/zac/Documents/juice/anvil/anvil/src/lib/tauri-commands.ts`

**Current state**: Defines `WorktreeInfo`, `ThreadStatus`, `ThreadMetadata` as plain TypeScript interfaces. Uses `invoke<T>()` generic for IPC calls.

**Issue**: Data from Tauri IPC commands comes from the Rust backend across a serialization boundary. While Rust is strongly typed, the JSON serialization can have version mismatches or bugs. Additionally, `ThreadStatus` and `ThreadMetadata` are duplicated here with different signatures than the canonical versions.

**Recommended action**:
1. Delete redundant `ThreadStatus` and `ThreadMetadata` types (import from `src/entities/threads/types.ts`)
2. Add Zod schema for `WorktreeInfo` (unique to this file)
3. Validate IPC responses at the boundary

```typescript
// Before
export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isBare: boolean;
}

// After
import { z } from "zod";
import { ThreadStatus, ThreadMetadata } from "@/entities/threads/types";

export const WorktreeInfoSchema = z.object({
  path: z.string(),
  branch: z.string().nullable(),
  isBare: z.boolean(),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>;

// Usage in commands:
listWorktrees: async (repoPath: string) => {
  const raw = await invoke<unknown>("git_list_worktrees", { repoPath });
  return z.array(WorktreeInfoSchema).parse(raw);
},
```

**Priority**: Medium - IPC boundary validation catches Rust/TypeScript schema drift. Type consolidation prevents bugs from mismatched type definitions.

---

#### 2. `/Users/zac/Documents/juice/anvil/anvil/src/lib/agent-output-parser.ts`

**Current state**: Has hand-written validation functions (`parseEventMessage`, `parseStateMessage`, `parseLogMessage`) with manual type checking. Uses type assertions after validation.

**Issue**: This parses JSON from agent child process stdout - a clear trust boundary. The current manual validation is verbose and error-prone. It also casts `as unknown as ThreadState` which bypasses type safety.

**Recommended action**: Replace manual validation with Zod schemas. This file is the canonical place for agent output validation.

```typescript
// Before (manual validation)
function parseStateMessage(obj: Record<string, unknown>): AgentStateMessage | null {
  const { state } = obj;
  if (!isRecord(state)) { return null; }
  const { messages, workingDirectory, status } = state;
  if (!Array.isArray(messages)) { return null; }
  // ... many more checks ...
  return { type: "state", state: state as unknown as ThreadState };
}

// After (Zod validation)
const AgentStateMessageSchema = z.object({
  type: z.literal("state"),
  state: ThreadStateSchema,
});

function parseStateMessage(obj: unknown): AgentStateMessage | null {
  const result = AgentStateMessageSchema.safeParse(obj);
  return result.success ? result.data : null;
}
```

**Priority**: High - This is the primary trust boundary for agent data. Current manual validation is duplicated logic that Zod would eliminate.

---

#### 3. `/Users/zac/Documents/juice/anvil/anvil/src/lib/persistence.ts`

**Current state**: Uses `readJson<T>()` with generic type parameter - no runtime validation. Casts JSON directly to the expected type.

**Issue**: This reads JSON from disk files. Data can be corrupted, wrong version, or manually edited.

**Recommended action**: The `readJson` method should accept an optional Zod schema. Callers loading critical data (like `RepositorySettings`) should validate.

```typescript
// Before
async readJson<T>(path: string): Promise<T | null> {
  const fullPath = await this.resolvePath(path);
  return await this.fs.readJsonFile<T>(fullPath);
}

// After (add schema-aware overload)
async readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | null>;
async readJson<T>(path: string): Promise<T | null>;
async readJson<T>(path: string, schema?: z.ZodType<T>): Promise<T | null> {
  const fullPath = await this.resolvePath(path);
  const raw = await this.fs.readJsonFile<unknown>(fullPath);
  return schema ? schema.parse(raw) : raw as T;
}
```

**Note**: The actual validation should happen in entity services (taskService, repositoryService) that know the schema, not in the generic persistence layer. The pattern doc says schemas live alongside types.

**Priority**: Medium - Disk persistence is a trust boundary, but validation belongs in domain code.

---

#### 4. `/Users/zac/Documents/juice/anvil/anvil/src/lib/repo-store-client.ts`

**Current state**: Defines `RepositoryMetadata`, `RepositoryVersion`, `Repository`, `CreateRepositoryOptions` as plain interfaces. Reads/writes JSON with no validation.

**Issue**:
1. Reads `metadata.json` from disk - trust boundary.
2. **Type duplication**: `RepositoryMetadata` and `RepositoryVersion` are ALSO defined in `/Users/zac/Documents/juice/anvil/anvil/src/entities/repositories/types.ts` with DIFFERENT signatures (entities uses `number` for timestamps, this file uses `string`).

**Recommended action**:
1. **Delete duplicate types** from this file
2. **Consolidate** into `src/entities/repositories/types.ts` with Zod schemas
3. Import from the canonical location
4. Decide on timestamp format (recommend `number` for consistency with rest of codebase)

```typescript
// In src/entities/repositories/types.ts - add schemas:
export const RepositoryMetadataSchema = z.object({
  name: z.string(),
  originalUrl: z.string().nullable(),
  sourcePath: z.string().nullable(),
  useWorktrees: z.boolean(),
  createdAt: z.number(),
});
export type RepositoryMetadata = z.infer<typeof RepositoryMetadataSchema>;

export const RepositoryVersionSchema = z.object({
  version: z.number(),
  createdAt: z.number(),
  path: z.string(),
});
export type RepositoryVersion = z.infer<typeof RepositoryVersionSchema>;

// In repo-store-client.ts - import instead of define:
import {
  RepositoryMetadata,
  RepositoryMetadataSchema,
  RepositoryVersion,
  RepositoryVersionSchema,
  Repository,
} from "@/entities/repositories/types";
```

**Priority**: High - Type inconsistency between files could cause runtime bugs. Consolidation should happen BEFORE adding Zod schemas.

---

#### 5. `/Users/zac/Documents/juice/anvil/anvil/src/lib/prompt-history-service.ts`

**Current state**: Defines `PromptHistoryEntry` and `PromptHistoryData` as plain interfaces. Reads/writes to `prompt-history.json`.

**Issue**: Reads persisted state from disk.

**Recommended action**: Add Zod schemas.

```typescript
const PromptHistoryEntrySchema = z.object({
  prompt: z.string(),
  timestamp: z.number(),
  taskId: z.string().optional(),
});

const PromptHistoryDataSchema = z.object({
  version: z.literal(1),
  entries: z.array(PromptHistoryEntrySchema),
});
```

**Priority**: Low - Prompt history is non-critical data; corruption just loses history.

---

#### 6. `/Users/zac/Documents/juice/anvil/anvil/src/lib/workspace-settings-service.ts`

**Current state**: Defines `WorkspaceSettings` as plain interface. Uses `SettingsStoreClient` to read/write JSON.

**Issue**: Reads settings from disk.

**Recommended action**: Add Zod schema.

```typescript
const WorkspaceSettingsSchema = z.object({
  repository: z.string().nullable(),
  anthropicApiKey: z.string().nullable(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;
```

**Priority**: Low - Small, simple settings object.

---

#### 7. `/Users/zac/Documents/juice/anvil/anvil/src/lib/settings-store-client.ts`

**Current state**: Generic key-value settings store using `readJsonFile<T>()` with no runtime validation.

**Issue**: The `get<T>()` method reads JSON from disk and casts to generic type `T` without validation. This is a trust boundary where corrupted or malformed data could cause runtime errors.

**Recommended action**: Add an optional schema parameter for validated reads (similar to the suggestion for `persistence.ts`).

```typescript
// Before
async get<T>(key: string): Promise<T | null> {
  // ... reads and casts to T without validation
}

// After - add schema-aware overload
async get<T>(key: string, schema: z.ZodType<T>): Promise<T | null>;
async get<T>(key: string): Promise<T | null>;
async get<T>(key: string, schema?: z.ZodType<T>): Promise<T | null> {
  const path = await this.getSettingPath(key);
  if (!(await this.fs.exists(path))) {
    return null;
  }
  try {
    const raw = await this.fs.readJsonFile<unknown>(path);
    return schema ? schema.parse(raw) : raw as T;
  } catch {
    return null;
  }
}
```

**Priority**: Low - The validation should happen in callers (like `workspace-settings-service.ts`), not in this generic layer.

---

#### 8. `/Users/zac/Documents/juice/anvil/anvil/src/lib/filesystem-client.ts`

**Current state**: Defines `DirEntry` and `PathsInfo` as plain interfaces. Uses `invoke<T>()` for IPC responses.

**Issue**: IPC responses from Rust filesystem commands should be validated. `PathsInfo` has snake_case fields (`data_dir`, `config_dir`) suggesting it comes directly from Rust serde serialization.

**Recommended action**: Add Zod schemas for IPC response types.

```typescript
export const DirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
  isFile: z.boolean(),
});
export type DirEntry = z.infer<typeof DirEntrySchema>;

export const PathsInfoSchema = z.object({
  data_dir: z.string(),
  config_dir: z.string(),
  app_suffix: z.string(),
  is_alternate_build: z.boolean(),
});
export type PathsInfo = z.infer<typeof PathsInfoSchema>;
```

**Priority**: Medium - Filesystem metadata from Rust backend crosses IPC boundary.

---

### Files Correctly Using Plain TypeScript (no changes needed)

These files define internal types that don't cross trust boundaries:

| File | Reason |
|------|--------|
| `agent-state-machine.ts` | Pure functions with TypeScript types |
| `agent-service.ts` | Internal service interface, callbacks |
| `simple-agent-service.ts` | Internal service interface |
| `event-bridge.ts` | Internal event routing (events already validated at source) |
| `types/agent-messages.ts` | Re-exports from SDK and core (validated elsewhere) |
| `diff-parser.ts` | Internal data structures for parsed diffs |
| `slug.ts` | Pure string transformation functions |
| `utils/*.ts` | Internal UI utilities (turn grouping, tool icons, etc.) |
| `language-*.ts` | Internal detection logic |
| `syntax-highlighter.ts` | Internal rendering utilities |
| `highlight-diff.ts` | Internal rendering utilities |
| `annotated-file-builder.ts` | Internal data structures |
| `optimistic.ts` | Generic utility function |
| `logger-client.ts` | Simple logging wrapper |
| `hotkey-service.ts` | Thin IPC wrapper (returns primitives) |
| `anvil-bootstrap.ts` | Orchestration only |
| `constants.ts` | Compile-time constants |
| `calculator-service.ts` | Internal service |

---

### Shared Types in Core Package

The `/core/types/events.ts` file defines shared types used by both the Node agent and the Tauri frontend. These types (`ThreadState`, `FileChange`, `EventPayloads`, etc.) cross trust boundaries when:

1. Agent emits JSON to stdout (parsed in `agent-output-parser.ts`)
2. Events are broadcast via Tauri IPC (in `event-bridge.ts`)

**Recommendation**: Add Zod schemas to `core/types/events.ts` so both sides can validate. The agent already emits structured data, and adding schemas there would let both Node and Tauri validate at their respective boundaries.

---

## Summary Table

| File | Current State | Action | Priority |
|------|--------------|--------|----------|
| `repo-store-client.ts` | Duplicate types | **Consolidate types first** | **Critical** |
| `tauri-commands.ts` | Duplicate types | **Delete duplicates, add Zod** | **High** |
| `agent-output-parser.ts` | Manual validation | Replace with Zod | **High** |
| `filesystem-client.ts` | Plain TS | Add Zod for IPC types | Medium |
| `persistence.ts` | Generic `<T>` | Callers should validate | Medium |
| `settings-store-client.ts` | Generic `<T>` | Add schema parameter | Low |
| `prompt-history-service.ts` | Plain TS | Add Zod | Low |
| `workspace-settings-service.ts` | Plain TS | Add Zod | Low |

---

## Implementation Notes

1. **Start with `agent-output-parser.ts`** - Highest impact, replaces 100+ lines of manual validation with clean Zod schemas.

2. **Create schemas in core/types** - Since `core/types/events.ts` is shared between Node and Tauri, schemas there benefit both sides.

3. **IPC validation pattern** - For Tauri commands, validate at the command wrapper level, not at every call site:
   ```typescript
   // In tauri-commands.ts
   export const gitCommands = {
     listWorktrees: async (repoPath: string) => {
       const raw = await invoke<unknown>("git_list_worktrees", { repoPath });
       return z.array(WorktreeInfoSchema).parse(raw);
     },
   };
   ```

4. **Disk validation pattern** - Validate when loading from disk in entity services:
   ```typescript
   // In taskService
   const raw = await persistence.readJson(`tasks/${slug}/metadata.json`);
   const task = TaskMetadataSchema.parse(raw);
   ```

---

## Recommended Execution Order

Execute in this order to avoid breaking changes and maximize incremental value:

### Phase 1: Type Consolidation (Critical - Do First)

These must be done before adding Zod schemas to avoid schema duplication:

1. **Consolidate `RepositoryMetadata` and `RepositoryVersion`**
   - Move canonical definitions to `src/entities/repositories/types.ts`
   - Decide on `number` for timestamps (matches rest of codebase)
   - Update `src/lib/repo-store-client.ts` to import from entities
   - Fix any timestamp format mismatches in existing data

2. **Consolidate `ThreadStatus` and `ThreadMetadata`**
   - Keep canonical definitions in `src/entities/threads/types.ts`
   - Update `src/lib/tauri-commands.ts` to import
   - Update `core/types/events.ts` to import `ThreadStatusType`

### Phase 2: High-Priority Zod Additions

3. **Add schemas to `core/types/events.ts`**
   - `ThreadStateSchema`, `FileChangeSchema`, `AgentEventMessageSchema`, etc.
   - These are used by both Node agent and Tauri frontend

4. **Refactor `src/lib/agent-output-parser.ts`**
   - Import schemas from `core/types/events.ts`
   - Replace manual validation with `safeParse()`
   - Remove ~100 lines of validation code

### Phase 3: IPC Boundary Validation

5. **Add schemas to `src/lib/tauri-commands.ts`**
   - `WorktreeInfoSchema` (unique to this file)
   - Wrap `invoke()` calls with `.parse()`

6. **Add schemas to `src/lib/filesystem-client.ts`**
   - `DirEntrySchema`, `PathsInfoSchema`
   - Wrap relevant `invoke()` calls

### Phase 4: Disk Persistence Schemas

7. **Add schemas to `src/entities/repositories/types.ts`**
   - `RepositoryMetadataSchema`, `RepositorySettingsSchema`, etc.
   - Validate in `loadSettings()` in persistence.ts

8. **Add schemas to remaining low-priority files**
   - `prompt-history-service.ts`
   - `workspace-settings-service.ts`

---

## Files NOT in src/lib That Need Audit

This audit focused on `src/lib`. The following directories also contain trust boundary code and need separate audits:

- `src/entities/*/` - Entity services that read/write to disk
- `core/types/` - Shared types between Node agent and Tauri (started above)
- `agents/src/` - Node agent code that parses CLI args and emits JSON

Create separate audit files for these directories.
