# Phase 3: Stores & Services

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

**Priority**: Medium - depends on types being updated first.

## Files to Update

### 1. src/entities/conversations/store.ts

```typescript
// Rename interfaces
ConversationState → ThreadState
ConversationActions → ThreadActions
ConversationUIState → ThreadUIState
ConversationUIActions → ThreadUIActions

// Rename store hooks
useConversationStore → useThreadStore
useConversationUIStore → useThreadUIStore

// Rename methods
getConversation → getThread
getConversationsByTask → getThreadsByTask
getConversationsByStatus → getThreadsByStatus
getRunningConversations → getRunningThreads
setConversation → setThread

// Rename selectors
selectConversation → selectThread

// Update internal variable names
conversationId → threadId
conversations → threads
```

### 2. src/entities/conversations/service.ts

```typescript
// Rename service instance
conversationService → threadService

// Rename class if exists
ConversationService → ThreadService

// Rename methods
getConversation → getThread
createConversation → createThread
updateConversation → updateThread
deleteConversation → deleteThread
hydrate - update internal refs

// Update internal variable names
```

### 3. src/entities/conversations/index.ts

```typescript
// Update all exports
export { useConversationStore } → useThreadStore
export { conversationService } → threadService
export * from "./types" // types already renamed
```

### 4. src/entities/index.ts

```typescript
// Update imports and re-exports
import { useConversationStore } → useThreadStore
import { conversationService } → threadService
export { useConversationStore } → useThreadStore
export { conversationService } → threadService

// Update import paths (after directory rename)
from "./conversations/..." → from "./threads/..."
```

### 5. src/lib/agent-service.ts

```typescript
// Update all conversation references
conversationId → threadId
conversation → thread
// Variable names, method parameters, event emissions
```

### 6. src/lib/workspace-service.ts

```typescript
// Update conversation references
```

### 7. src/lib/tauri-commands.ts

```typescript
// Rename command wrappers
conversationCommands → threadCommands
getConversationStatus → getThreadStatus
getConversation → getThread

// Update processCommands parameter names in JSDoc/types
conversationId → threadId
```

### 8. src/lib/event-bridge.ts

```typescript
// Update event handlers and references
```

### 9. src/lib/hotkey-service.ts

```typescript
// Update any conversation-related hotkey handlers
```

### 10. src/entities/tasks/service.ts

```typescript
// Rename methods
linkConversation → linkThread
unlinkConversation → unlinkThread

// Update internal references
conversationId → threadId
conversationIds → threadIds
```

## Directory Rename

After updating all content:
```bash
mv src/entities/conversations src/entities/threads
```

## Verification

```bash
pnpm typecheck
```

## Checklist

- [ ] src/entities/conversations/store.ts
- [ ] src/entities/conversations/service.ts
- [ ] src/entities/conversations/index.ts
- [ ] src/entities/index.ts
- [ ] src/lib/agent-service.ts
- [ ] src/lib/workspace-service.ts
- [ ] src/lib/tauri-commands.ts
- [ ] src/lib/event-bridge.ts
- [ ] src/lib/hotkey-service.ts
- [ ] src/entities/tasks/service.ts
- [ ] Rename directory: conversations → threads
- [ ] Update import paths in all consuming files
- [ ] pnpm typecheck passes
