# Phase 1: TypeScript Types & Interfaces

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

**Priority**: Must complete first - other phases depend on these types.

## Files to Update

### 1. src/entities/conversations/types.ts

```typescript
// Rename all type definitions
ConversationStatus → ThreadStatus
ConversationTurn → ThreadTurn
ConversationMetadata → ThreadMetadata
CreateConversationInput → CreateThreadInput
UpdateConversationInput → UpdateThreadInput
```

### 2. src/lib/types/agent-messages.ts

```typescript
ConversationState → ThreadState
```

### 3. src/lib/tauri-commands.ts (Local Type Declarations)

```typescript
// Lines 29-35 - These duplicate entity types for Tauri
export type ConversationStatus → ThreadStatus
export interface ConversationMetadata → ThreadMetadata
  // Also rename field: conversationId → threadId if present
```

### 4. src/entities/events.ts

```typescript
// Update type imports
import type { ConversationMetadata, ConversationStatus } → ThreadMetadata, ThreadStatus

// Update event payload types in AppEvents
"agent:spawned": { conversationId → threadId }
"agent:state": { conversationId → threadId }
"agent:completed": { conversationId → threadId }
"agent:error": { conversationId → threadId }
```

### 5. src/entities/tasks/types.ts

```typescript
// Update conversation-related fields
conversationIds → threadIds
```

### 6. src/entities/repositories/types.ts

Check for any conversation references (grep hit).

### 7. core/types/index.ts

```typescript
CONVERSATIONS_DIR → THREADS_DIR  // "conversations" → "threads"
```

## Verification

After completing this phase:
```bash
# Should only show file renames pending, not type errors
pnpm typecheck
```

## Checklist

- [ ] src/entities/conversations/types.ts
- [ ] src/lib/types/agent-messages.ts
- [ ] src/lib/tauri-commands.ts (local types)
- [ ] src/entities/events.ts
- [ ] src/entities/tasks/types.ts
- [ ] src/entities/repositories/types.ts
- [ ] core/types/index.ts
- [ ] Run typecheck to verify
