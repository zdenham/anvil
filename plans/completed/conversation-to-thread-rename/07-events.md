# Phase 6: Event System

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

**Priority**: Medium - update alongside stores/services.

## Files to Update

### 1. src/entities/events.ts

```typescript
// Import updates (types already renamed in Phase 1)
import type { ThreadState } from "@/lib/types/agent-messages";
import type { ThreadMetadata, ThreadStatus } from "./threads/types";

// Rename event keys in AppEvents type
export type AppEvents = {
  // Agent Process Events
  "agent:spawned": { threadId: string; taskId: string };       // was conversationId
  "agent:state": { threadId: string; state: ThreadState };     // was conversationId
  "agent:completed": { threadId: string; exitCode: number; costUsd?: number };
  "agent:error": { threadId: string; error: string };

  // Thread Events (renamed from Conversation Events)
  "thread:created": { metadata: ThreadMetadata };              // was conversation:created
  "thread:updated": { id: string; updates: Partial<ThreadMetadata> };
  "thread:status-changed": { id: string; status: ThreadStatus };

  // ... rest unchanged
};
```

### 2. src/lib/event-bridge.ts

```typescript
// Update event listeners
eventBus.on("conversation:created", ...) → eventBus.on("thread:created", ...)
eventBus.on("conversation:updated", ...) → eventBus.on("thread:updated", ...)
eventBus.on("conversation:status-changed", ...) → eventBus.on("thread:status-changed", ...)

// Update event emissions
eventBus.emit("conversation:created", ...) → eventBus.emit("thread:created", ...)

// Update payload destructuring
{ conversationId } → { threadId }
```

### 3. All Event Subscribers

Search for and update all files that subscribe to conversation events:
```bash
rg "conversation:" --type ts
```

Files likely affected:
- Store files
- Service files
- Hook files
- Component files

## Tauri Event Names

### Rust side (panels.rs, lib.rs)

```rust
// Tauri event emissions
"open-conversation" → "open-thread"
```

### Frontend listeners

```typescript
// Listen for Tauri events
listen("open-conversation", ...) → listen("open-thread", ...)
```

## Verification

```bash
# Check no conversation events remain
rg '"conversation:' --type ts

# Typecheck
pnpm typecheck
```

## Checklist

- [ ] src/entities/events.ts - rename event keys and payloads
- [ ] src/lib/event-bridge.ts - update listeners and emitters
- [ ] Update all event subscribers (grep for "conversation:")
- [ ] Update Tauri event names (Rust side)
- [ ] Update Tauri event listeners (Frontend side)
- [ ] Verify no "conversation:" events remain
- [ ] pnpm typecheck passes
