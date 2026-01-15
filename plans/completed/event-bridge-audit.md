# Event Bridge Pattern Audit

Comprehensive audit of event listener conformance based on `docs/patterns/event-bridge.md`.

## Summary

| Category | Status | Issues Found |
|----------|--------|--------------|
| Direct Tauri listen() imports | ⚠️ Minor | 7 files import from @tauri-apps/api/event |
| emitTo() usage | ✅ Compliant | None found |
| Event payload state misuse | ❌ Violation | 1 handler uses payload as data |
| Bloated event emissions | ❌ Violation | 3 emission sites with excess payload |
| useEffect async cleanup races | ✅ Compliant | None found |

---

## Violations

### 1. Direct Tauri Event Imports (Outside event-bridge.ts)

Per the pattern, only `src/lib/event-bridge.ts` should import from `@tauri-apps/api/event`.

#### Files with Type Imports (Low Priority)
These import `UnlistenFn` type for bridge cleanup handling:

| File | Import |
|------|--------|
| `src/task-main.tsx:5` | `emit`, `UnlistenFn` |
| `src/error-main.tsx:3` | `UnlistenFn` |
| `src/clipboard-main.tsx:4` | `UnlistenFn` |
| `src/tasks-panel-main.tsx:5` | `UnlistenFn` |
| `src/simple-task-main.tsx:5` | `UnlistenFn` |
| `src/spotlight-main.tsx:5` | `UnlistenFn` |

#### Test File Import (Acceptable)
| File | Import | Notes |
|------|--------|-------|
| `src/components/tasks-panel/tasks-panel.ui.test.tsx:14` | `listen` | Mocked for testing |

**Recommendation:** Re-export `UnlistenFn` type from `event-bridge.ts` to eliminate direct dependency.

---

### 2. Event Payload Used as State (Anti-Pattern)

Events should be signals that trigger disk refreshes, not data containers.

#### PERMISSION_REQUEST Handler
**File:** `src/entities/permissions/listeners.ts:9-18`

```typescript
eventBus.on(EventName.PERMISSION_REQUEST, (payload) => {
  const result = PermissionRequestSchema.safeParse(payload);
  if (!result.success) {
    logger.warn("[PermissionListener] Invalid permission request:", result.error);
    return;
  }
  usePermissionStore.getState()._applyAddRequest(result.data);  // ❌ Direct state update
});
```

**Problem:** Full permission request data from event payload is applied directly to store. This bypasses disk-as-source-of-truth.

**Recommendation:** Either:
1. Persist permission requests to disk, emit only `{ requestId }`, then refresh from disk
2. Or accept that permissions are ephemeral and document the exception

---

### 3. Bloated Event Emissions

Events should contain minimal identifiers, not full entity data.

#### permission:request - Includes Full toolInput
**File:** `agents/src/permissions/permission-handler.ts:74-80`

```typescript
emitEvent("permission:request", {
  requestId,
  threadId,
  toolName,
  toolInput,        // ❌ Can be large/unstructured
  timestamp: Date.now(),
});
```

**Recommendation:** Remove `toolInput` from event. Store full input in permission store, emit only IDs.

---

#### thread:created - Extra Fields Not in Schema
**File:** `agents/src/runners/simple-runner-strategy.ts:311-316`

```typescript
emitEvent("thread:created", {
  threadId,
  taskId,
  agent: "simple",  // ❌ Not in EventPayloads[THREAD_CREATED]
  cwd,              // ❌ Not in EventPayloads[THREAD_CREATED]
});
```

**File:** `agents/src/runners/task-runner-strategy.ts:319-323`

```typescript
emitEvent("thread:created", {
  threadId: config.threadId,
  taskSlug,         // ❌ Not in schema
  agent: config.agent,  // ❌ Not in schema
});
```

**Schema Definition** (`core/types/events.ts`):
```typescript
[EventName.THREAD_CREATED]: { threadId: string; taskId: string };
```

**Recommendation:** Align with schema - emit only `{ threadId, taskId }`.

---

#### agent:state - Full ThreadState Object
**File:** `src/lib/agent-service.ts:311-314`
**File:** `src/components/workspace/task-workspace.tsx:600`

```typescript
eventBus.emit(EventName.AGENT_STATE, {
  threadId,
  state: threadState,  // Full ThreadState with messages, fileChanges, metrics
});
```

**Status:** Schema-compliant (intentionally carries full state for UI updates). This is the largest payload by design and may warrant documentation as an exception.

---

## Compliant Areas

### emitTo() Usage
No usage found. The codebase correctly uses broadcast `emit()` as documented.

### useEffect Async Cleanup
No components use the anti-pattern:
```typescript
// BAD - Not found anywhere
useEffect(() => {
  const unlisten = listen("event", handler);
  return () => unlisten.then(fn => fn());
}, []);
```

All components correctly use `eventBus.on/off`:
```typescript
// GOOD - Used throughout
useEffect(() => {
  eventBus.on("event", handler);
  return () => eventBus.off("event", handler);
}, []);
```

### Disk Refresh Pattern
Most entity listeners correctly use IDs-only and trigger refreshes:

| Entity | File | Pattern |
|--------|------|---------|
| Tasks | `src/entities/tasks/listeners.ts` | ✅ `{ taskId }` → `taskService.refreshTask()` |
| Threads | `src/entities/threads/listeners.ts` | ✅ `{ threadId }` → `threadService.refreshById()` |
| Repositories | `src/entities/repositories/listeners.ts` | ✅ `{ name }` → `repoService.refresh()` |

---

## Action Items

### High Priority
- [ ] **Permission events**: Decide on persistence strategy for permission requests
- [ ] **thread:created emissions**: Remove `agent`, `cwd`, `taskSlug` fields - align with schema

### Medium Priority
- [ ] **permission:request emission**: Remove `toolInput` from payload
- [ ] **Type re-exports**: Export `UnlistenFn` from `event-bridge.ts`

### Low Priority / Document
- [ ] **agent:state payload**: Document as intentional exception (full state for UI)

---

## Files to Modify

1. `agents/src/permissions/permission-handler.ts` - Reduce payload
2. `agents/src/runners/simple-runner-strategy.ts` - Fix thread:created emission
3. `agents/src/runners/task-runner-strategy.ts` - Fix thread:created emission
4. `src/entities/permissions/listeners.ts` - Implement refresh pattern (if persisted)
5. `src/lib/event-bridge.ts` - Add `export type { UnlistenFn }`
6. Entry point files - Update imports to use event-bridge re-export
