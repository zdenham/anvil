# Sub-plan 1: Shared Types Foundation

**Parent Plan**: `plans/event-system-overhaul.md`
**Phases Covered**: Phase 1
**Parallel With**: None (must complete first)
**Blocks**: Sub-plans 2, 3, 4

---

## Goal

Establish single source of truth for all event types shared between Node agent and Tauri frontend.

---

## Prerequisites

### Path Alias Configuration

Verify/configure `@core/*` path alias in both packages:

1. **`agents/tsconfig.json`**:
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@core/*": ["../core/*"]
       }
     }
   }
   ```

2. **`tsconfig.json`** (frontend):
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@core/*": ["../core/*"],
         "@/*": ["./src/*"]
       }
     }
   }
   ```

3. **`vite.config.ts`**:
   ```typescript
   resolve: {
     alias: {
       "@core": path.resolve(__dirname, "core"),
     }
   }
   ```

---

## Tasks

### 1. Create `core/types/events.ts`

Create the file with:
- `EventName` const object with all event names
- `EventNameType` type derived from EventName
- `EventPayloads` interface mapping event names to payloads
- `FileChange`, `ResultMetrics`, `ToolExecutionState`, `ThreadState` types
- `AgentEventMessage`, `AgentStateMessage`, `AgentLogMessage` types
- `AgentOutput` union type

See full type definitions in parent plan lines 274-460.

### 2. Create `core/types/settings.ts`

```typescript
/**
 * Workflow execution mode.
 * Shared between frontend settings and agent merge logic.
 */
export type WorkflowMode = "auto" | "review" | "manual";
```

### 3. Update `core/types/index.ts`

Add exports:
```typescript
export * from "./events.js";
export * from "./settings.js";
// ... existing exports
```

### 4. Remove Duplicate Types

| File | Types to Remove |
|------|-----------------|
| `agents/src/output.ts` | `ThreadState`, `FileChange`, `ResultMetrics`, `ToolExecutionState` |
| `src/lib/types/agent-messages.ts` | `ThreadState`, `FileChange`, `ResultMetrics`, `ToolExecutionState` |
| `agents/src/agent-types/merge-types.ts` | `WorkflowMode` |

### 5. Update Imports

Search and replace imports throughout codebase to use `@core/types/events.js`:

```bash
# Find files that need updating
grep -r "ThreadState" --include="*.ts" --include="*.tsx" agents/ src/
grep -r "FileChange" --include="*.ts" --include="*.tsx" agents/ src/
grep -r "WorkflowMode" --include="*.ts" --include="*.tsx" agents/ src/
```

---

## Checklist

- [ ] Verify `@core/*` path alias in `agents/tsconfig.json`
- [ ] Verify `@core/*` path alias in `tsconfig.json`
- [ ] Verify `@core` resolve alias in `vite.config.ts`
- [ ] Create `core/types/events.ts`
- [ ] Create `core/types/settings.ts`
- [ ] Update `core/types/index.ts` exports
- [ ] Delete duplicate types from `agents/src/output.ts`
- [ ] Delete duplicate types from `src/lib/types/agent-messages.ts`
- [ ] Delete `WorkflowMode` from `agents/src/agent-types/merge-types.ts`
- [ ] Update imports throughout codebase
- [ ] Run `pnpm typecheck` to verify no type errors

---

## Completion Criteria

- All shared types defined in `core/types/events.ts`
- No duplicate type definitions in `agents/` or `src/`
- `pnpm typecheck` passes
- Both `agents/` and `src/` can import from `@core/types/events.js`

---

## Next Steps

After completion, unblock:
- **Sub-plan 2**: Agent Event System (Phases 2, 3, 4)
- **Sub-plan 3**: Frontend Parsing & Service (Phases 5, 6, 7)
