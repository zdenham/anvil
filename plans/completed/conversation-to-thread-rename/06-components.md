# Phase 5: React Components

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

**Priority**: Medium-Low - depends on hooks and stores being updated.

## Directory: src/components/conversation/ → src/components/thread/

### Files with "conversation" in filename (must rename)

1. **conversation-window.tsx → thread-window.tsx**
   ```typescript
   // Rename component
   ConversationWindow → ThreadWindow

   // Update internal refs
   conversationId → threadId
   conversation → thread

   // Update hook/store calls
   useConversationMessages → useThreadMessages
   useStreamingConversation → useStreamingThread
   ```

2. **conversation-view.tsx → thread-view.tsx**
   ```typescript
   // Rename component
   ConversationView → ThreadView

   // Update internal refs
   ```

### Files with conversation references (content update only)

3. **assistant-message.tsx**
   - Check for `conversation` variable names
   - Update any conversation-related props

4. **message-list.tsx**
   - Update `conversationId` prop/variable names
   - Update store/hook calls

5. **turn-renderer.tsx**
   - Update `conversation` references

6. **loading-state.tsx**
   - May have "Loading conversation..." text

7. **empty-state.tsx**
   - May have conversation-related text

8. **error-state.tsx**
   - May have conversation-related error messages

9. **status-announcement.tsx**
   - Update status-related conversation refs

10. **index.ts**
    - No component renames needed (exports don't use "conversation")
    - Will need path update after directory rename

### Files likely unchanged
- streaming-cursor.tsx
- system-message.tsx
- text-block.tsx
- thinking-block.tsx
- user-message.tsx
- file-change-block.tsx
- tool-use-block.tsx

## Other Component Files

### src/components/spotlight/spotlight.tsx

```typescript
// Update conversation-related code
openConversation → openThread
conversationId → threadId
```

### src/components/diff-viewer/diff-viewer.tsx

Check for conversation references (appeared in grep).

### src/conversation-main.tsx → src/thread-main.tsx

```typescript
// Entry point for conversation window
// Rename file and update imports
```

### src/App.tsx

Check for conversation references.

## Directory Rename

After updating all content:
```bash
mv src/components/conversation src/components/thread
```

## File Renames

After updating content:
```bash
mv src/components/thread/conversation-window.tsx src/components/thread/thread-window.tsx
mv src/components/thread/conversation-view.tsx src/components/thread/thread-view.tsx
mv src/conversation-main.tsx src/thread-main.tsx
```

## Verification

```bash
pnpm typecheck
```

## Checklist

### Must rename (update content first, then rename)
- [ ] conversation-window.tsx
- [ ] conversation-view.tsx
- [ ] src/conversation-main.tsx

### Update content only
- [ ] assistant-message.tsx
- [ ] message-list.tsx
- [ ] turn-renderer.tsx
- [ ] loading-state.tsx
- [ ] empty-state.tsx
- [ ] error-state.tsx
- [ ] status-announcement.tsx
- [ ] index.ts (export paths)

### Other components
- [ ] src/components/spotlight/spotlight.tsx
- [ ] src/components/diff-viewer/diff-viewer.tsx
- [ ] src/App.tsx

### Directory operations
- [ ] Rename directory: conversation → thread
- [ ] Rename files (after content updates)
- [ ] pnpm typecheck passes
