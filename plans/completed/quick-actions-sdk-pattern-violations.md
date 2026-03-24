# Quick Actions SDK Plan - Pattern Violations

This document consolidates major violations of Anvil's architectural patterns found in `plans/quick-actions-sdk.md`. These should be addressed before implementation.

---

## Major Violations Summary

| Pattern | Violation | Impact |
|---------|-----------|--------|
| YAGNI | External projects, FileSystemService | Over-engineered SDK surface area |
| Adapters | Direct adapter instantiation instead of injection | Untestable code |
| Entity-Stores | Array instead of Record, missing listeners.ts | Performance and event-driven updates broken |
| Zod-Boundaries | Registry, runner context, SDK events lack validation | Runtime errors from malformed data |
| Type-Layering | Duplicate type definitions, naming conflicts | Type drift and confusion |
| Disk-as-Truth | Event handlers mutate stores directly | State sync issues |
| Event-Bridge | SDK events bypass cross-window broadcast | Multi-window inconsistency |

---

## YAGNI Violations

### 1. External Projects Support (Major)
**Sections:** 1.4, 5.5

The plan explicitly states "This is an advanced feature - most users will just use the default project" yet includes:
- Full `externalProjects` array in registry schema
- `stale` boolean tracking for missing directories
- Validation logic for external projects
- Design decisions #6 and #32 dedicated to it

**Recommendation:** Remove entirely. Add when first user requests it.

### 2. FileSystemService API (Major)
**Section:** 2.1

The SDK exposes `readFile`, `writeFile`, `exists`, `readDir`, `glob` - none of which are used by any example action. All demonstrated use cases only need Thread, Plan, and UI services.

**Recommendation:** Remove entirely. Add methods as concrete needs arise.

### 3. ~~GitService API~~ (Keeping)
**Section:** 2.1

~~Six git methods defined (`getCurrentBranch`, `getDefaultBranch`, `getHeadCommit`, `branchExists`, `listBranches`, `getDiff`) - none used by any example action.~~

**Decision:** Keep GitService - git context is essential for quick actions operating on repositories.

---

## Adapters Pattern Violations

### 1. SDK Runtime Direct Adapter Instantiation (Major)
**Section:** Phase 3.1

```typescript
export function createSDK(anvilDir, emitEvent): AnvilSDK {
  const fs = new NodeFSAdapter();  // Direct instantiation
  const git = new NodeGitAdapter(); // Direct instantiation
}
```

The adapters pattern requires constructor injection for testability.

**Recommendation:**
```typescript
export function createSDK(
  anvilDir: string,
  fs: FileSystemAdapter,
  git: GitAdapter,
  emitEvent: (event, payload) => void
): AnvilSDK
```

---

## Entity-Stores Pattern Violations

### 1. Store Uses Array Instead of Record (Major)
**Section:** 1.5

```typescript
interface QuickActionsState {
  actions: QuickActionMetadata[];  // WRONG
}
```

The pattern requires `Record<string, QuickActionMetadata>` keyed by ID for O(1) lookups.

**Recommendation:**
```typescript
interface QuickActionsState {
  actions: Record<string, QuickActionMetadata>;
}
```

### 2. Missing listeners.ts File (Major)
**Section:** 1.5-1.6

The plan creates store.ts, service.ts, types.ts but NOT listeners.ts. Without listeners, event-driven updates won't work properly.

**Recommendation:** Add `src/entities/quick-actions/listeners.ts` following the established pattern.

---

## Zod-Boundaries Violations

### 1. QuickActionsRegistry Lacks Zod Schema (Major)
**Section:** 1.4

The registry at `~/.anvil/quick-actions-registry.json` is defined as a plain TypeScript interface but loaded from disk. Disk data requires Zod validation.

**Recommendation:** Add `QuickActionsRegistrySchema` alongside other schemas in Phase 1.1.

### 2. Runner Context Parsing Without Validation (Major)
**Section:** 3.3

```typescript
const context: QuickActionContext = JSON.parse(values.context!);
```

The runner receives JSON via CLI args (a trust boundary) and parses without Zod validation.

**Recommendation:**
```typescript
const context = QuickActionExecutionContextSchema.parse(JSON.parse(values.context!));
```

### 3. SDK Event Parsing Lacks Validation (Major)
**Section:** 3.2

```typescript
const event = parseSDKEvent(line);  // No schema shown
```

IPC from child processes requires Zod validation.

**Recommendation:** Define `SDKEventSchema` using `z.discriminatedUnion()` for all event types.

---

## Type-Layering Violations

### 1. Parallel Type Definitions (Major)
**Sections:** 2.1, 3.1, 3.3

The SDK defines `ThreadInfo` and `PlanInfo` types that appear distinct from core's `ThreadMetadata`. This creates parallel type hierarchies that will drift.

**Recommendation:** SDK types should either:
- Re-export from `core/types/threads.ts` and `core/types/plans.ts`
- Be explicitly defined as SDK-specific projections with documented relationship

### 2. QuickActionContext Name Collision (Major)
**Sections:** 1.1, 2.1

Two different types share the name `QuickActionContext`:
1. `core/types/quick-actions.ts`: Schema for storage metadata contexts (enum)
2. `core/sdk/types.ts`: Runtime context passed to actions (object)

**Recommendation:** Rename runtime context to `QuickActionExecutionContext`.

---

## Disk-as-Truth Violations

### 1. SDK Event Handlers Don't Refresh From Disk (Major)
**Section:** 7.1

```typescript
eventBus.on('quick-action:set-input', ({ content }) => {
  inputStore.setContent(content);  // Direct mutation from event payload
});
```

The pattern requires events to trigger disk re-reads, not use event payloads as data.

**Recommendation:** For write operations like `sdk.threads.archive()`, emit entity events (`thread:updated`) and let existing listeners refresh from disk.

---

## Event-Bridge Violations

### 1. SDK Events Bypass Cross-Window Broadcast (Major)
**Section:** 3.2

```typescript
eventBus.emit('quick-action:set-input', { content: event.payload });
```

The quick action executor emits directly to local eventBus without going through the Tauri broadcast step. Other windows won't receive these events.

**Recommendation:** Quick actions that affect shared state (archives, etc.) must follow the full event-bridge flow:
```
SDK stdout → executor → entity service → eventBus → event-bridge → Tauri emit → all windows
```

### 2. UI Control Events Use Payload as Data (Major)
**Section:** 7.1

Events like `quick-action:navigate` use payload data directly for navigation logic instead of triggering a refresh pattern.

**Recommendation:** Navigation state (`selectedItemId`) is persisted to disk via the tree-menu store (`src/stores/tree-menu/store.ts`). The `quick-action:navigate` event should use the refresh pattern:
1. SDK emits navigation intent with target (thread/plan ID)
2. Executor calls `treeMenuService.setSelectedItem(id)` which writes to disk
3. Tree-menu store refreshes from disk via existing listener pattern
4. UI updates reactively from store state

This keeps navigation consistent with the disk-as-truth pattern used elsewhere.

---

## Action Items

### Must Fix (Major Violations)

1. **Simplify SDK scope**: Remove External Projects and FileSystemService (keep GitService)
2. **Fix adapter injection**: `createSDK()` and executor should accept adapters
3. **Fix store structure**: Use `Record<string, T>` not arrays
4. **Add listeners.ts**: Create proper event listener setup
5. **Add Zod schemas**: Registry, runner context, SDK events
6. **Resolve type conflicts**: Rename `QuickActionContext` in SDK to `QuickActionExecutionContext`
7. **Fix event flow**: SDK entity operations should emit standard events through event-bridge

### Consider (Minor Violations)

- SDK types location (`core/sdk/types.ts` vs `core/types/sdk.ts`)
- Template files location (consider `templates/` directory)
- Input store draft persistence to disk
- Selectors as store methods vs component-level
