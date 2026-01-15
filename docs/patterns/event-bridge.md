# Event Bridge Pattern

## Overview

The Event Bridge routes all events through a single mitt bus (`eventBus`), providing synchronous `on/off` APIs that avoid async cleanup race conditions.

**Event categories:**
- **Broadcast** - Agent events that go to all windows (`task:updated`, `agent:state`)
- **Local** - Window-specific Tauri events (`panel-hidden`, `open-simple-task`)
- **Window** - Synthetic events from window APIs (`window:focus-changed`)

## Key Principle: Events Are Signals, Not Data

**Events are notification signals that trigger refreshes - never rely on event metadata for state.**

The payload carries just enough info to identify what changed (e.g., `taskId`, `threadId`), but listeners always refresh from disk to get the current state. This ensures:

- Disk remains the single source of truth
- No stale data from race conditions
- No need to keep event payloads in sync with entity schemas

## Event Flow Architecture

```
Agent (Node)                    Tauri Frontend
─────────────────────────────────────────────────────────────────
stdout JSON ──► agent-service ──► eventBus.emit() ──► event-bridge
                  (parses)         (local mitt)     ──► Tauri emit()
                                                          │
                                                          ▼
                                               ┌──────────────────┐
                                               │   ALL WINDOWS    │
                                               │  (main, panels)  │
                                               └──────────────────┘
                                                          │
                                                          ▼
                                               listeners.ts ──► service.refresh() ──► disk
```

## Implementation Details

### Agent Event Emission (Node)

Agents emit events via `agents/src/lib/events.ts`:

```typescript
// Events are written to stdout as JSON
emitEvent(EventName.TASK_UPDATED, { taskId });
```

This outputs: `{"type":"event","name":"task:updated","payload":{"taskId":"abc123"}}`

### Tauri Event Bridge

The bridge (`src/lib/event-bridge.ts`) does two things:

1. **Outgoing** - Forwards local mitt events to Tauri for cross-window broadcast
2. **Incoming** - Listens for Tauri events and emits to local mitt

```typescript
// Outgoing: mitt -> Tauri broadcast
eventBus.on(eventName, async (payload) => {
  await emit(`app:${eventName}`, payload);  // Broadcast to ALL windows
});

// Incoming: Tauri -> mitt
await listen(`app:${eventName}`, (event) => {
  eventBus.emit(eventName, event.payload);
});
```

### Entity Listeners

Each entity has a `listeners.ts` that subscribes to events and triggers disk refreshes:

```typescript
// src/entities/tasks/listeners.ts
eventBus.on(EventName.TASK_UPDATED, async ({ taskId }) => {
  await taskService.refreshTask(taskId);  // Read from disk, update store
});
```

## Do / Don't

### DO: Use Events as Signals

```typescript
// GOOD: Event triggers refresh, data comes from disk
eventBus.on(EventName.TASK_UPDATED, async ({ taskId }) => {
  await taskService.refreshTask(taskId);
});
```

### DON'T: Rely on Event Payload for State

```typescript
// BAD: Using event payload as data source
eventBus.on(EventName.TASK_UPDATED, async ({ taskId, title, status }) => {
  useTaskStore.setState({ [taskId]: { title, status } });  // Stale data risk!
});
```

### DO: Use `emit()` for Broadcast

```typescript
// GOOD: Broadcasts to all windows including NSPanels
await emit("app:task:updated", { taskId });
```

### DON'T: Use `emitTo()` for Panels

```typescript
// BAD: emitTo doesn't work reliably with NSPanels
await emitTo("task", "app:task:updated", payload);
```

### DO: Keep Payloads Minimal

```typescript
// GOOD: Just enough to identify the entity
events.taskUpdated(taskId);  // Payload: { taskId: "abc123" }
```

### DON'T: Include Full Entity Data

```typescript
// BAD: Payload duplicates entity schema
emitEvent(EventName.TASK_UPDATED, {
  taskId,
  title: task.title,
  status: task.status,
  threads: task.threads,
  // ...entire task object
});
```

### DON'T: Use Direct Tauri `listen()` in Components

```typescript
// BAD: Async cleanup causes race conditions in StrictMode
useEffect(() => {
  const unlisten = listen("panel-hidden", handler);
  return () => unlisten.then(fn => fn());  // Race!
}, []);

// GOOD: Synchronous cleanup via eventBus
useEffect(() => {
  eventBus.on("panel-hidden", handler);
  return () => eventBus.off("panel-hidden", handler);
}, []);
```

Only `event-bridge.ts` should import from `@tauri-apps/api/event`.

## Event Types

| Category | Events |
|----------|--------|
| Task | `task:created`, `task:updated`, `task:deleted`, `task:status-changed` |
| Thread | `thread:created`, `thread:updated`, `thread:status-changed` |
| Agent | `agent:spawned`, `agent:state`, `agent:completed`, `agent:error` |
| Worktree | `worktree:allocated`, `worktree:released` |
| Repository | `repository:created`, `repository:updated`, `repository:deleted` |
| Local | `panel-hidden`, `panel-shown`, `open-simple-task`, `open-task`, `show-error` |
| Window | `window:focus-changed` |

## Selective Subscription

Windows can opt into specific event categories using `IncomingBridgeOptions`:

```typescript
interface IncomingBridgeOptions {
  broadcasts?: boolean;  // Cross-window events (default: true)
  local?: boolean;       // Rust panel events (default: true)
  windowApi?: boolean;   // Window focus events (default: true)
}
```

**Use case:** Windows that emit broadcasts typically don't need to receive them:

```typescript
// Spotlight: emits broadcasts, only needs local + windowApi
setupOutgoingBridge();
setupIncomingBridge({ broadcasts: false });

// Task panel: receive-only, needs all categories
setupIncomingBridge(); // defaults to all true
```

This makes intent explicit and avoids unnecessary event processing.

## Echo Prevention

When a window has both outgoing and incoming bridges, there's a risk of infinite loops:

1. Local event emits → outgoing bridge sends to Tauri
2. Tauri broadcasts to ALL windows (including source)
3. Source window's incoming bridge receives and emits locally
4. Repeat → infinite loop

**Primary defense:** Use selective subscription (`broadcasts: false`) for windows that emit broadcasts.

**Backup defense:** The bridge also adds a `_source` field to outgoing payloads:

```typescript
// Outgoing bridge adds source
const outgoingPayload = { ...payload, _source: windowLabel };
await emit(`app:${eventName}`, outgoingPayload);

// Incoming bridge filters and strips
if (payload._source === currentWindowLabel) {
  return; // Skip our own events
}
const { _source, ...cleanPayload } = payload;
eventBus.emit(eventName, cleanPayload);
```

This is handled automatically - consumers never see `_source` in event payloads.

### Window Labels

Each window has a unique label set at creation (in `panels.rs`):
- `spotlight`, `clipboard`, `task`, `error`, `simple-task`, `tasks-list`, `main`

## Setup

```typescript
// Entry point (e.g., simple-task-main.tsx)
const cleanup = await setupIncomingBridge();

// Cleanup on window close
getCurrentWindow().onCloseRequested(() => cleanup.forEach(fn => fn()));
```
