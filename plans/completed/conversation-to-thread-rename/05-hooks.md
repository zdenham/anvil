# Phase 4: React Hooks

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

**Priority**: Medium - depends on types and stores being updated.

## Files to Update

### 1. src/hooks/use-conversation-messages.ts

```typescript
// Rename hook
useConversationMessages → useThreadMessages

// Rename internal variables
conversationId → threadId
conversation → thread

// Update store/service calls
useConversationStore → useThreadStore
conversationService → threadService
```

### 2. src/hooks/use-streaming-conversation.ts

```typescript
// Rename hook
useStreamingConversation → useStreamingThread

// Rename internal variables and parameters
conversationId → threadId

// Update store/service calls
```

### 3. src/hooks/use-agent-execution.ts

```typescript
// Update internal conversation refs
conversationId → threadId
conversation → thread

// Update store/service calls
useConversationStore → useThreadStore
conversationService → threadService
```

### 4. src/hooks/index.ts

```typescript
// Update exports
export { useConversationMessages } → useThreadMessages
export { useStreamingConversation } → useStreamingThread

// Update import paths (after file renames)
from "./use-conversation-messages" → from "./use-thread-messages"
from "./use-streaming-conversation" → from "./use-streaming-thread"
```

## File Renames

After updating content:
```bash
mv src/hooks/use-conversation-messages.ts src/hooks/use-thread-messages.ts
mv src/hooks/use-streaming-conversation.ts src/hooks/use-streaming-thread.ts
```

## Verification

```bash
pnpm typecheck
```

## Checklist

- [ ] src/hooks/use-conversation-messages.ts - update content
- [ ] src/hooks/use-streaming-conversation.ts - update content
- [ ] src/hooks/use-agent-execution.ts - update internal refs
- [ ] Rename: use-conversation-messages.ts → use-thread-messages.ts
- [ ] Rename: use-streaming-conversation.ts → use-streaming-thread.ts
- [ ] src/hooks/index.ts - update exports and paths
- [ ] pnpm typecheck passes
