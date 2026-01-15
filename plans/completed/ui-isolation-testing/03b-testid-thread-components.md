# Sub-Plan: Test IDs for Thread Components

**Dependencies:** None
**Blocks:** Thread-related UI tests (05-first-tests.md)
**Parallel With:** 03a, 03c, 03d

## Objective

Add `data-testid` attributes to thread-related components for stable test selectors.

## Target Components

All thread components are located in `src/components/thread/`:

| Component | File | Purpose |
|-----------|------|---------|
| ThreadView | `thread-view.tsx` | Main thread container, handles state routing |
| MessageList | `message-list.tsx` | Virtualized scrollable message list |
| TurnRenderer | `turn-renderer.tsx` | Routes turns to UserMessage/AssistantMessage |
| UserMessage | `user-message.tsx` | User message bubble |
| AssistantMessage | `assistant-message.tsx` | Assistant response with tool blocks |
| StatusAnnouncement | `status-announcement.tsx` | Screen reader status updates |
| LoadingState | `loading-state.tsx` | Loading indicator |
| ErrorState | `error-state.tsx` | Error display with retry |
| EmptyState | `empty-state.tsx` | Empty thread placeholder |

## Required Test IDs

Based on `src/test/helpers/queries.ts`:

### Container IDs
```tsx
// ThreadView container (replaces "thread-panel")
data-testid="thread-panel"

// MessageList container
data-testid="message-list"

// Thread header (if applicable)
data-testid="thread-header"
```

### Status ID
```tsx
// Thread status indicator
data-testid="thread-status"
```

### Indexed IDs (0-indexed by turn/message position)
```tsx
// Individual messages
data-testid={`message-${index}`}

// Message content (for text extraction)
data-testid={`message-content-${index}`}
```

### State IDs
```tsx
// Loading spinner
data-testid="loading-spinner"

// Error message display
data-testid="error-message"

// Empty state placeholder
data-testid="empty-state"
```

## Implementation Details

### ThreadView (`thread-view.tsx`)

Add `data-testid="thread-panel"` to the main container and ensure state components have their test IDs:

```tsx
// Main container (line ~76)
<div
  data-testid="thread-panel"
  className="relative flex-1 flex flex-col min-h-0"
  role="main"
  aria-label="Thread with AI assistant"
>
```

The state rendering already delegates to LoadingState, ErrorState, EmptyState - add test IDs to those.

### MessageList (`message-list.tsx`)

Add `data-testid="message-list"` to the container. Note: This uses `react-virtuoso` for virtualization.

```tsx
// Container (line ~57)
<div
  data-testid="message-list"
  className="flex-1 min-h-0 overflow-hidden relative"
  role="log"
  aria-live="polite"
>
```

### TurnRenderer (`turn-renderer.tsx`)

Pass index prop and add test ID to rendered messages:

```tsx
// Wrap the returned component
<div data-testid={`message-${turnIndex}`}>
  <UserMessage turn={turn} />
</div>
```

Alternatively, pass the `data-testid` as a prop to UserMessage/AssistantMessage.

### State Components

| Component | Test ID | Element |
|-----------|---------|---------|
| LoadingState | `loading-spinner` | Loading indicator |
| ErrorState | `error-message` | Error container |
| EmptyState | `empty-state` | Empty placeholder |

## Steps

1. **Verify file locations exist**
   ```bash
   ls src/components/thread/
   ```

2. **Add container test IDs**
   - `thread-view.tsx`: Add `data-testid="thread-panel"` to main div
   - `message-list.tsx`: Add `data-testid="message-list"` to container div

3. **Add state component test IDs**
   - `loading-state.tsx`: Add `data-testid="loading-spinner"`
   - `error-state.tsx`: Add `data-testid="error-message"`
   - `empty-state.tsx`: Add `data-testid="empty-state"`

4. **Add indexed message test IDs**
   - Update `message-list.tsx` to pass index to TurnRenderer
   - Update `turn-renderer.tsx` to accept and use index for test ID
   - Ensure each rendered turn has `data-testid={message-${index}}`

5. **Add thread status test ID (if applicable)**
   - Check if there's a visible status indicator
   - Add `data-testid="thread-status"` if present

6. **Verify IDs match queries.ts**
   - `testIds.threadPanel` -> `"thread-panel"`
   - `testIds.threadStatus` -> `"thread-status"`
   - `testIds.messageList` -> `"message-list"`
   - `testIds.messageItem(n)` -> `"message-${n}"`
   - `testIds.loadingSpinner` -> `"loading-spinner"`
   - `testIds.errorMessage` -> `"error-message"`
   - `testIds.emptyState` -> `"empty-state"`

## Virtualization Consideration

The MessageList uses `react-virtuoso` for virtualized rendering. This means:

- Only visible messages are in the DOM at any time
- Test IDs will only be present for rendered items
- Tests may need to scroll to make items visible before querying
- Consider using `waitFor` or scroll utilities in tests

The test ID pattern still works, but tests must account for virtualization behavior.

## Verification

```bash
# Ensure no TypeScript errors
pnpm typecheck

# Ensure app still builds
pnpm build

# Run any existing thread tests
pnpm test --grep "thread"
```

## Acceptance Criteria

- [ ] `data-testid="thread-panel"` on ThreadView container
- [ ] `data-testid="message-list"` on MessageList container
- [ ] `data-testid="loading-spinner"` on LoadingState
- [ ] `data-testid="error-message"` on ErrorState
- [ ] `data-testid="empty-state"` on EmptyState
- [ ] Each message/turn has `data-testid={message-${index}}`
- [ ] All test IDs match patterns in `src/test/helpers/queries.ts`
- [ ] TypeCheck passes
- [ ] Build succeeds
- [ ] No component behavior changes (only attribute additions)

## Notes

- Message/turn indexing starts at 0
- Do not change component behavior, only add data-testid attributes
- If a component doesn't accept `data-testid` prop, spread props or add wrapper
- The codebase uses "turns" (grouped messages) rather than individual messages - test IDs should align with what's visually rendered
